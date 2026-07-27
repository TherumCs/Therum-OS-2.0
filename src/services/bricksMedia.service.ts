import { basename } from 'node:path';
import { mediaService } from './media.service.js';
import { isCanvasNode, replaceCanvasSrc, type CanvasNode } from '../lib/render.js';

// Bricks Bridge media localization — the "media step" after an import.
// A Bricks layout arrives pointing at its source site's uploads
// (/wp-content/uploads/…). This walks the imported canvas, downloads each
// image into OUR media library (real MediaAsset rows via the same
// EXIF-strip/thumbnail upload pipeline as a manual upload — so everything
// shows up in the admin Media list like native uploads), and rewrites the
// canvas srcs to the new /api/uploads/ URLs. No WordPress anywhere.

const MAX_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

export interface LocalizeReport {
  localized: { from: string; to: string; assetId: string }[];
  skipped: { src: string; reason: string }[];
}

function collectImageSrcs(node: CanvasNode, out: Set<string>): void {
  if (node.type === 'image') {
    const src = node.props?.src;
    // Already-local uploads and inline data URIs stay untouched.
    if (typeof src === 'string' && src !== '' && !src.startsWith('/api/uploads/') && !src.startsWith('data:')) {
      out.add(src);
    }
  }
  for (const c of node.children ?? []) {
    if (isCanvasNode(c)) collectImageSrcs(c, out);
  }
}

function filenameFor(url: URL): string {
  try {
    const name = basename(decodeURIComponent(url.pathname));
    return name || 'asset';
  } catch {
    return basename(url.pathname) || 'asset';
  }
}

async function fetchAsset(url: URL): Promise<{ buffer: Buffer; mimetype: string }> {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) throw new Error('empty response');
  if (buffer.length > MAX_BYTES) throw new Error(`larger than ${MAX_BYTES} bytes`);
  const mimetype = res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
  return { buffer, mimetype };
}

// Deep pass: a ported layout carries asset URLs far beyond canvas image-node
// srcs — background images in settings, src/srcset/url() inside raw HTML
// fragments. Collect every wp-content asset reference from every string in
// every node, download once per distinct file, then string-rewrite globally.
const ASSET_URL_RE = /(?:https?:\/\/[^"'\s)\\,]+)?\/wp-content\/[^"'\s)\\,]+?\.(?:png|jpe?g|webp|gif|svg|avif|mp4|webm|woff2?)/gi;

function collectDeepUrls(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    for (const m of value.match(ASSET_URL_RE) ?? []) out.add(m);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectDeepUrls(v, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectDeepUrls(v, out);
  }
}

function rewriteDeep<T>(value: T, from: string, to: string): T {
  if (typeof value === 'string') {
    return (value as string).split(from).join(to) as unknown as T;
  }
  if (Array.isArray(value)) {
    return (value as unknown[]).map((v) => rewriteDeep(v, from, to)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    for (const k of Object.keys(rec)) rec[k] = rewriteDeep(rec[k], from, to);
    return value;
  }
  return value;
}

export const bricksMediaService = {
  // Mutates the canvas in place (same contract as replaceCanvasSrc) and
  // returns what happened per URL. One fetch per distinct src — a layout
  // reusing an image 10× produces one asset and 10 rewrites. Failures are
  // reported per-src, never thrown: a dead image on the source site must not
  // sink the other 22.
  async localize(canvas: CanvasNode, baseUrl: string): Promise<LocalizeReport> {
    const report: LocalizeReport = { localized: [], skipped: [] };
    const srcs = new Set<string>();
    collectImageSrcs(canvas, srcs);

    for (const src of srcs) {
      let resolved: URL;
      try {
        resolved = new URL(src, baseUrl);
      } catch {
        report.skipped.push({ src, reason: 'unresolvable URL' });
        continue;
      }
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
        report.skipped.push({ src, reason: `unsupported protocol ${resolved.protocol}` });
        continue;
      }
      try {
        const { buffer, mimetype } = await fetchAsset(resolved);
        const asset = await mediaService.upload({ filename: filenameFor(resolved), mimetype, buffer });
        replaceCanvasSrc(canvas, src, asset.url);
        report.localized.push({ from: src, to: asset.url, assetId: asset.id });
      } catch (e) {
        report.skipped.push({ src, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return report;
  },

  // Deep localization — canvas image nodes PLUS every asset URL found in any
  // string anywhere in the tree (background settings, HTML fragments with
  // src/srcset/url(), fonts, videos). Same per-src failure isolation.
  async deepLocalize(canvas: CanvasNode, baseUrl: string): Promise<LocalizeReport> {
    const report = await this.localize(canvas, baseUrl);
    const urls = new Set<string>();
    collectDeepUrls(canvas, urls);

    for (const src of urls) {
      if (src.startsWith('/api/uploads/')) continue;
      let resolved: URL;
      try {
        resolved = new URL(src, baseUrl);
      } catch {
        report.skipped.push({ src, reason: 'unresolvable URL' });
        continue;
      }
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
        report.skipped.push({ src, reason: `unsupported protocol ${resolved.protocol}` });
        continue;
      }
      try {
        let fetched;
        try {
          fetched = await fetchAsset(resolved);
        } catch (first) {
          // Legacy absolute URLs (old dev domains) — retry same path on baseUrl.
          const retry = new URL(resolved.pathname + resolved.search, baseUrl);
          if (retry.href === resolved.href) throw first;
          fetched = await fetchAsset(retry);
        }
        const asset = await mediaService.upload({ filename: filenameFor(resolved), mimetype: fetched.mimetype, buffer: fetched.buffer });
        rewriteDeep(canvas, src, asset.url);
        report.localized.push({ from: src, to: asset.url, assetId: asset.id });
      } catch (e) {
        report.skipped.push({ src, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return report;
  },
};
