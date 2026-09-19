import { createHash } from 'node:crypto';
import sharp from 'sharp';

// libvips keeps decoded frames in a process-wide cache and will happily run
// several operations at once. Inside the worker — which PM2 restarts at a
// memory ceiling — that cache is what pushes a campaign send over the edge
// mid-run, and a restarted worker is a stalled send. One image at a time, no
// cache: this path re-encodes seven pictures once per campaign, so neither
// costs anything worth having.
sharp.cache(false);
sharp.concurrency(1);
import type { MailAttachment } from './notification.service.js';
import { logger } from '../lib/logger.js';

// Embed a campaign's images IN the message instead of linking to them.
//
// A remote <img> in an email is a request the RECIPIENT'S client decides
// whether to make. Outlook desktop blocks by default, Gmail and Apple Mail
// both have a switch, corporate gateways strip them outright — and every one
// of those people sees an email of empty boxes no matter how healthy the URL
// is on our side. Serving the file correctly is not the same as the reader
// seeing it, so the picture travels with the message: each image becomes a
// related MIME part and the tag points at `cid:` — nothing to fetch, nothing
// to block.
//
// Two things are deliberately left alone:
//   - the open-tracking pixel, which only works BECAUSE it is fetched
//   - anything not served by this store (we do not re-host other people's files)

const MAX_WIDTH = 1200; // the body is 600 CSS px; twice that stays sharp on a phone
const MAX_BYTES = 900_000; // per image, after re-encoding — a guard, not a target
const FETCH_TIMEOUT_MS = 20_000;

export interface InlinedEmail {
  html: string;
  attachments: MailAttachment[];
}

const MAX_FETCH_BYTES = 12_000_000; // refuse before buffering anything bigger

function isStoreImage(url: string, origin: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    if (u.origin !== new URL(origin).origin) return false;
    // The open pixel must stay remote or opens stop counting, and the click
    // redirect is not a picture — through it, "our origin" would resolve to
    // wherever `u` points, which is how a campaign author could aim this
    // fetcher at loopback or the internal payments engine.
    if (/^\/(api\/)?m\/(o|c)\//.test(u.pathname)) return false;
    // Only files: the uploads mount and the static asset host paths.
    if (!/^\/(api\/uploads|wp-content\/uploads)\//.test(u.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchImage(url: string, origin: string): Promise<{ body: Buffer; contentType: string } | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    // No redirects: a 3xx from our own origin could send this anywhere, and the
    // first-hop check above would have already said yes.
    const res = await fetch(url, { signal: ctl.signal, redirect: 'error' });
    if (!res.ok) return null;
    if (new URL(res.url || url).origin !== new URL(origin).origin) return null;
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
    if (!contentType.startsWith('image/')) return null;
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_FETCH_BYTES) return null;
    // Stream with a hard cap — a missing or lying content-length must not let
    // one image buffer the worker into its memory ceiling.
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_FETCH_BYTES) { await reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
    return { body: Buffer.concat(chunks.map((c) => Buffer.from(c))), contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Re-encode to something a mail client renders and a mailbox can hold. */
async function shrink(body: Buffer, contentType: string): Promise<{ body: Buffer; contentType: string; ext: string } | null> {
  try {
    const img = sharp(body, { animated: false });
    const meta = await img.metadata();
    const resized = (meta.width ?? 0) > MAX_WIDTH ? img.resize({ width: MAX_WIDTH, withoutEnlargement: true }) : img;
    // Transparency has to survive (the wordmark is a PNG on the card's white).
    if (meta.hasAlpha) {
      const out = await resized.png({ compressionLevel: 9, palette: true }).toBuffer();
      return out.length <= MAX_BYTES ? { body: out, contentType: 'image/png', ext: 'png' } : null;
    }
    const out = await resized.jpeg({ quality: 78, mozjpeg: true }).toBuffer();
    return out.length <= MAX_BYTES ? { body: out, contentType: 'image/jpeg', ext: 'jpg' } : null;
  } catch {
    // Not something sharp reads — send the original if it is small enough.
    return body.length <= MAX_BYTES ? { body, contentType, ext: contentType.split('/')[1] ?? 'img' } : null;
  }
}

/**
 * Rewrite every store image in `html` to a `cid:` reference and return the
 * parts to attach. Build this ONCE per campaign and reuse it for every
 * recipient — it is the same picture 300 times.
 *
 * An image that cannot be fetched or shrunk keeps its original URL, so the
 * worst case is exactly today's behaviour for that one image rather than a
 * broken send.
 */
export async function inlineImages(html: string, origin: string): Promise<InlinedEmail> {
  const urls = [...new Set([...html.matchAll(/<img[^>]+src="([^"]+)"/gi)].map((m) => m[1]!))].filter((u) => isStoreImage(u, origin));
  if (urls.length === 0) return { html, attachments: [] };

  const attachments: MailAttachment[] = [];
  let out = html;
  for (const url of urls) {
    const got = await fetchImage(url, origin);
    if (!got) {
      logger.warn({ url }, 'campaign image could not be fetched for inlining — leaving the remote URL');
      continue;
    }
    const small = await shrink(got.body, got.contentType);
    if (!small) {
      logger.warn({ url, bytes: got.body.length }, 'campaign image too big to inline — leaving the remote URL');
      continue;
    }
    // The cid's domain part is the store's own host — this file ships in the product, not the store.
    const cid = `img${createHash('sha1').update(url).digest('hex').slice(0, 16)}@${(() => { try { return new URL(origin).hostname; } catch { return 'store'; } })()}`;
    attachments.push({
      filename: `${cid.split('@')[0]}.${small.ext}`,
      content: small.body,
      contentType: small.contentType,
      cid,
      contentDisposition: 'inline',
    });
    out = out.split(`src="${url}"`).join(`src="cid:${cid}"`);
  }
  const bytes = attachments.reduce((n, a) => n + a.content.length, 0);
  logger.info({ images: attachments.length, of: urls.length, bytes }, 'campaign images embedded in the message');
  return { html: out, attachments };
}
