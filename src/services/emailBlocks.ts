import { db } from '../lib/db.js';
import { money } from '../site/html.js';
import { T, esc, nw, eyebrow, h1, para, button, hair, section, shell } from './emailTemplate.js';

// Campaign composer — blocks in, branded email out.
//
// A campaign is authored as a stack of BLOCKS (the source of truth, stored as
// JSON) and rendered through the same kit every receipt and login code uses,
// so a newsletter can never look like it came from a different store. Every
// block also exposes the HTML it generated; the composer shows that HTML and
// lets it be edited (`custom`), which is the escape hatch for styling
// something the block fields do not cover. A block with `custom` set renders
// that verbatim — the generated form is only the starting point.
//
// Merge tags are left in the rendered HTML as-is and swapped per recipient at
// send time (see marketingService.personalise): {{first_name}}, {{email}},
// {{unsubscribe_url}}.

export type Block =
  | { id: string; type: 'eyebrow'; text: string; custom?: string }
  | { id: string; type: 'heading'; text: string; custom?: string }
  | { id: string; type: 'text'; html: string; align?: 'center' | 'left'; custom?: string }
  | { id: string; type: 'image'; src: string; alt?: string; href?: string; full?: boolean; custom?: string }
  | { id: string; type: 'button'; label: string; url: string; custom?: string }
  | { id: string; type: 'divider'; custom?: string }
  | { id: string; type: 'spacer'; height?: number; custom?: string }
  | { id: string; type: 'product'; slug: string; label?: string; custom?: string }
  | { id: string; type: 'html'; html: string; custom?: string };

export type BlockType = Block['type'];

export const BLOCK_TYPES: BlockType[] = ['eyebrow', 'heading', 'text', 'image', 'button', 'divider', 'spacer', 'product', 'html'];

const PAD = '0 48px';

interface ProductCard {
  name: string;
  slug: string;
  image: string | null;
  price: number | null;
  currency: string;
}

async function productCard(slug: string): Promise<ProductCard | null> {
  const p = await db.product.findFirst({
    where: { slug, deletedAt: null },
    select: { name: true, slug: true, image: true, variants: { select: { price: true }, orderBy: { price: 'asc' }, take: 1 } },
  });
  if (!p) return null;
  const v = p.variants[0];
  return { name: p.name, slug: p.slug, image: p.image, price: v ? v.price : null, currency: 'USD' };
}

const abs = (origin: string, url: string): string => (/^https?:\/\//i.test(url) ? url : `${origin}${url.startsWith('/') ? '' : '/'}${url}`);

/** Render ONE block to its table row(s). Exported so the composer can show it. */
export async function renderBlock(b: Block, origin: string): Promise<string> {
  if (b.custom && b.custom.trim()) return b.custom;
  switch (b.type) {
    case 'eyebrow':
      return section(`22px 48px 0`, eyebrow(b.text || '', T.red));
    case 'heading':
      return section(`6px 48px 0`, h1(esc(b.text || '')));
    case 'text': {
      const align = b.align === 'left' ? 'text-align:left;' : '';
      // Authored HTML (bold, links, line breaks) is allowed here on purpose —
      // it is the merchant's own copy, written in the composer.
      return section(`16px 48px 0`, para(b.html || '', align));
    }
    case 'image': {
      if (!b.src) return '';
      const img = `<img src="${esc(abs(origin, b.src))}" alt="${esc(b.alt || '')}" width="${b.full ? 600 : 504}" style="display:block;width:100%;max-width:${b.full ? 600 : 504}px;height:auto;border:0;background:${T.thumb};">`;
      const inner = b.href ? `<a href="${esc(b.href)}" style="display:block;">${img}</a>` : img;
      return section(b.full ? '20px 0 0' : `20px 48px 0`, inner);
    }
    case 'button':
      return section(`22px 48px 0`, button(b.label || 'Shop now', b.url || origin));
    case 'divider':
      return section(`24px 48px 0`, hair());
    case 'spacer':
      return `<tr><td style="height:${Math.max(4, Math.min(120, b.height ?? 24))}px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
    case 'product': {
      const p = await productCard(b.slug);
      if (!p) return section(PAD, `<p style="color:${T.red};text-align:center;font-size:12px;">Product “${esc(b.slug)}” not found</p>`);
      const url = `${origin}/product/${encodeURIComponent(p.slug)}`;
      const img = p.image ? `<a href="${esc(url)}"><img src="${esc(abs(origin, p.image))}" alt="${esc(p.name)}" width="504" style="display:block;width:100%;max-width:504px;height:auto;border:0;background:${T.thumb};border-radius:10px;"></a>` : '';
      const price = p.price != null ? `<div style="margin-top:6px;text-align:center;font-size:18px;font-weight:800;color:${T.ink};">${esc(money(p.price, p.currency))}</div>` : '';
      return section(`22px 48px 0`, img
        + `<div style="margin-top:14px;font-size:15px;font-weight:700;color:${T.ink};text-align:center;">${nw(esc(p.name))}</div>`
        + price
        + `<div style="margin-top:14px;">${button(b.label || 'Shop it', url)}</div>`);
    }
    case 'html':
      return section(PAD, b.html || '');
    default:
      return '';
  }
}

export interface RenderOpts {
  blocks: Block[];
  preheader?: string;
  siteName: string;
  origin: string;
  /** Left as the literal merge tag when omitted, so it can be swapped per recipient. */
  unsubscribeUrl?: string;
}

/** Whole email: every block through the branded shell. */
export async function renderEmail(o: RenderOpts): Promise<string> {
  const parts: string[] = [];
  for (const b of o.blocks) parts.push(await renderBlock(b, o.origin));
  // Bottom breathing room before the footer hairline.
  parts.push(`<tr><td style="height:28px;font-size:0;line-height:0;">&nbsp;</td></tr>`);
  return shell(parts.join(''), { preheader: o.preheader, siteName: o.siteName, unsubscribeUrl: o.unsubscribeUrl ?? '{{unsubscribe_url}}', logoWidth: 210 });
}

/** Plain-text fallback, derived from the blocks so it never drifts from the HTML. */
export function renderText(blocks: Block[], origin: string): string {
  const strip = (h: string): string => h.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.type === 'eyebrow' || b.type === 'heading') lines.push((b.text || '').toUpperCase());
    else if (b.type === 'text') lines.push(strip(b.html || ''));
    else if (b.type === 'button') lines.push(`${b.label || 'Shop now'}: ${b.url || origin}`);
    else if (b.type === 'product') lines.push(`${origin}/product/${b.slug}`);
    else if (b.type === 'image' && b.href) lines.push(b.href);
    else if (b.type === 'html') lines.push(strip(b.html || ''));
    if (lines.length && lines[lines.length - 1]) lines.push('');
  }
  lines.push('Unsubscribe: {{unsubscribe_url}}');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Starter blocks for a new campaign so the composer never opens empty. */
export function starterBlocks(): Block[] {
  const id = () => Math.random().toString(36).slice(2, 10);
  return [
    { id: id(), type: 'eyebrow', text: 'New drop' },
    { id: id(), type: 'heading', text: 'Say it in one line' },
    { id: id(), type: 'text', html: 'Two or three sentences. Why it matters, what it is, where to get it.' },
    { id: id(), type: 'button', label: 'Shop now', url: '/shop' },
  ];
}
