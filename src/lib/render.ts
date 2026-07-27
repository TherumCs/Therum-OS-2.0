// Renders a builder canvas tree to HTML — the publish-time half of the
// builder↔Folio loop. Mirrors builder/src/lib/serialize.ts (keep in sync).
export interface CanvasNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children: CanvasNode[];
}

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ENT[c] ?? c);
const num = (v: unknown, d: number): number => (Number.isFinite(Number(v)) ? Number(v) : d);

export function isCanvasNode(v: unknown): v is CanvasNode {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as { type?: unknown }).type === 'string' &&
    Array.isArray((v as { children?: unknown }).children)
  );
}

// Walks an image node's `src` in place — used by the media rename engine to
// keep a canvas body pointing at the right file after a rename. Returns
// whether anything actually changed, so callers only write back rows that
// truly reference the renamed asset.
export function replaceCanvasSrc(node: CanvasNode, oldUrl: string, newUrl: string): boolean {
  let changed = false;
  if (node.type === 'image' && node.props?.src === oldUrl) {
    node.props.src = newUrl;
    changed = true;
  }
  for (const child of node.children ?? []) {
    if (isCanvasNode(child) && replaceCanvasSrc(child, oldUrl, newUrl)) changed = true;
  }
  return changed;
}

export function renderCanvas(node: CanvasNode): string {
  const p = node.props ?? {};
  if (node.id === 'root' && (node.children ?? []).some((c) => c?.props && ((c.props as Record<string, unknown>).__bricks !== undefined))) {
    return (node.children ?? []).map(renderCanvas).join('');
  }
  // Bricks-fidelity mode — imported layouts keep their element ids, classes,
  // raw HTML and background settings so the ported theme CSS styles them 1:1.
  if (p.__bricks !== undefined || p.__name !== undefined) {
    return renderBricksNode(node);
  }
  const kids = (node.children ?? []).map(renderCanvas).join('');
  switch (node.type) {
    case 'section':
      return `<section style="background:${esc(p.background)};padding:${num(p.padding, 0)}px"><div style="max-width:${num(p.maxWidth, 1100)}px;margin:0 auto">${kids}</div></section>`;
    case 'container':
      return `<div style="display:flex;flex-direction:${esc(p.direction)};gap:${num(p.gap, 0)}px;align-items:${esc(p.align)}">${kids}</div>`;
    case 'heading': {
      const lvl = ['h1', 'h2', 'h3'].includes(String(p.level)) ? String(p.level) : 'h2';
      return `<${lvl} style="color:${esc(p.color)};text-align:${esc(p.align)};margin:0">${esc(p.text)}</${lvl}>`;
    }
    case 'text':
      return `<p style="color:${esc(p.color)};font-size:${num(p.size, 16)}px;margin:0;line-height:1.6">${esc(p.content)}</p>`;
    case 'button':
      return `<a href="${esc(p.href)}" style="display:inline-block;background:${esc(p.background)};color:${esc(p.color)};padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${esc(p.label)}</a>`;
    case 'image':
      return `<img src="${esc(p.src)}" alt="${esc(p.alt)}" style="width:${num(p.width, 600)}px;max-width:100%;height:auto;border-radius:8px" />`;
    case 'productList':
      return `<div data-product-list data-limit="${num(p.limit, 6)}" data-columns="${num(p.columns, 3)}"></div>`;
    default:
      return kids ? `<div>${kids}</div>` : '';
  }
}

// Structural tags a ported layout may legitimately ask for. Anything outside
// this list falls back to <div> — no script/style/iframe smuggling via settings.
const ALLOWED_TAGS = new Set([
  'a', 'article', 'aside', 'b', 'blockquote', 'br', 'button', 'cite', 'code', 'dd', 'div',
  'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'header', 'hr', 'i', 'li', 'main',
  'mark', 'nav', 'ol', 'p', 'picture', 'pre', 's', 'section', 'small', 'span', 'strong',
  'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul',
]);
const VOID_TAGS = new Set(['br', 'hr']);

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// Imported-layout renderer. Raw HTML passthrough is deliberate: this content
// comes from an authenticated admin import (same trust level as Bricks itself
// rendering its own saved markup).
function renderBricksNode(node: CanvasNode): string {
  const p = node.props ?? {};
  const s = rec(p.__bricks);
  const name = typeof p.__name === 'string' && p.__name ? p.__name : node.type;
  const kids = (node.children ?? []).map(renderCanvas).join('');
  const classes = ['brxe-' + name];
  if (typeof s._cssClasses === 'string' && s._cssClasses) classes.push(s._cssClasses);
  const bgUrl = rec(rec(s._background).image).url;
  const style = typeof bgUrl === 'string' && bgUrl ? ` style="background-image:url('${esc(bgUrl)}')"` : '';
  // Element attributes (Bricks `_attributes`) — href, aria-*, data-*, role…
  // Without these, ported markup loses its links and a11y wiring.
  let extra = '';
  if (Array.isArray(s._attributes)) {
    for (const a of s._attributes as { name?: unknown; value?: unknown }[]) {
      const an = typeof a?.name === 'string' ? a.name.trim() : '';
      // only safe, non-event attributes
      if (!an || /^on/i.test(an) || !/^[a-zA-Z][\w:-]*$/.test(an)) continue;
      extra += ` ${an}="${esc(String(a?.value ?? ''))}"`;
    }
  }
  const idAttr = typeof s._cssId === 'string' && s._cssId ? esc(s._cssId) : `brxe-${esc(node.id)}`;
  const attrs = ` id="${idAttr}" class="${esc(classes.join(' '))}"${style}${extra}`;
  // Bricks svg element: signed svg code on WP, raw svg markup here.
  if (name === 'svg' && typeof s.code === 'string' && s.code.trim().startsWith('<svg')) {
    return `<div${attrs}>${s.code}</div>`;
  }
  // Bricks' custom-tag setting (tag: 'custom' + customTag). The ported theme
  // CSS is full of element selectors (ul.c-top-menu, li…, a…), so rendering
  // everything as <div> silently breaks nav spacing, lists and links.
  if (s.tag === 'custom' && typeof s.customTag === 'string' && ALLOWED_TAGS.has(s.customTag.toLowerCase())) {
    const ct = s.customTag.toLowerCase();
    if (VOID_TAGS.has(ct)) return `<${ct}${attrs} />`;
    return `<${ct}${attrs}>${typeof p.content === 'string' ? p.content : ''}${kids}</${ct}>`;
  }
  switch (node.type) {
    case 'section':
      return `<section${attrs}>${kids}</section>`;
    case 'heading': {
      const tag = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(String(s.tag)) ? String(s.tag) : 'h3';
      return `<${tag}${attrs}>${typeof p.text === 'string' ? p.text : ''}${kids}</${tag}>`;
    }
    case 'text':
      return `<div${attrs}>${typeof p.content === 'string' ? p.content : ''}${kids}</div>`;
    case 'button': {
      const href = typeof p.href === 'string' && p.href ? p.href : '#';
      return `<a${attrs.replace('class="', 'class="brxe-button ').replace('brxe-button brxe-', 'brxe-')} href="${esc(href)}">${typeof p.label === 'string' ? p.label : ''}</a>`;
    }
    case 'image': {
      const src = typeof p.src === 'string' ? p.src : '';
      return `<img${attrs} src="${esc(src)}" alt="${esc(typeof p.alt === 'string' ? p.alt : '')}" />`;
    }
    default:
      return `<div${attrs}>${kids}</div>`;
  }
}
