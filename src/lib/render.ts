// Renders a builder canvas tree to HTML — the publish-time half of the
// builder↔Folio loop. Mirrors builder/src/lib/serialize.ts (keep in sync).
import { PORTED_ELEMENT_IDS } from '../site/portedElementIds.js';
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

// Ported elements keep the ONE class our markup already carries: `el-<id>`.
//
// PORTING.md rule 2 is NOTHING ELEMENTOR. The stylesheet is generated from the
// reference's computed styles and keyed to `.el-<id>` (tools/bricks-css.mjs),
// so the id alone is the styling hook. Nothing about the old builder's class
// vocabulary — no `elementor-element-*`, no `e-con`, no `elementor-widget-*`,
// no wrapper layers — is emitted any more.
//
// Ids the reference has no element for are still marked: the conversion
// invented those nodes, and as empty flex children they eat space the design
// never allotted them (one took 475px out of the home hero's button row).
const ELEMENTOR_ID = /^el-([0-9a-f]{7,})$/;

export function expandElementorIds(cssClasses: string, _name: string): string {
  return cssClasses
    .split(/\s+/)
    .filter(Boolean)
    .map((c) => {
      const m = ELEMENTOR_ID.exec(c);
      if (!m) return c;
      return PORTED_ELEMENT_IDS.has(m[1]!) ? c : `${c} th-no-ref`;
    })
    .join(' ');
}

// Imported-layout renderer. Raw HTML passthrough is deliberate: this content
// comes from an authenticated admin import (same trust level as Bricks itself
// rendering its own saved markup).
function renderBricksNode(node: CanvasNode): string {
  const p = node.props ?? {};
  const s = rec(p.__bricks);
  const name = typeof p.__name === 'string' && p.__name ? p.__name : node.type;
  const rawKids = (node.children ?? []).map(renderCanvas).join('');
  const classes = ['brxe-' + name];
  const expanded = typeof s._cssClasses === 'string' && s._cssClasses
    ? expandElementorIds(s._cssClasses, name)
    : '';
  const LEAF = new Set(['heading', 'image', 'button', 'text', 'text-basic', 'svg', 'icon']);
  const portedId = /(?:^|\s)el-([0-9a-f]{6,})(?:\s|$)/.exec(expanded)?.[1] ?? null;
  const wrapWidget = Boolean(portedId) && LEAF.has(name);
  if (expanded && !wrapWidget) classes.push(expanded);
  const kids = rawKids;
  // The reference wraps every WIDGET in a div and styles the wrapper, with the
  // real element inside it:
  //
  //   <div class="...479c7f3" width:12%><img width:100% height:27px></div>
  //
  // We flattened that onto the element itself, so `.el-479c7f3 img{...}`
  // matched nothing and the logo rendered 0px against a reference 78px. The
  // wrapper is the reference's own structure, so it is ported — carrying only
  // our `el-<id>` class, no builder vocabulary. Containers are NOT wrapped:
  // there the styled element really is the element with the children.
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
  // The id goes on the wrapper when there is one, so a #id rule still lands on
  // the element the reference gives it to.
  const attrs = ` id="${idAttr}" class="${esc(classes.join(' '))}"${style}${extra}`;
  const wrap = (inner: string): string =>
    wrapWidget ? `<div class="${esc(expanded)}">${inner}</div>` : inner;
  // Bricks svg element: signed svg code on WP, raw svg markup here.
  if (name === 'svg' && typeof s.code === 'string' && s.code.trim().startsWith('<svg')) {
    return wrap(`<div${attrs}>${s.code}</div>`);
  }
  // Bricks' custom-tag setting (tag: 'custom' + customTag). The ported theme
  // CSS is full of element selectors (ul.c-top-menu, li…, a…), so rendering
  // everything as <div> silently breaks nav spacing, lists and links.
  if (s.tag === 'custom' && typeof s.customTag === 'string' && ALLOWED_TAGS.has(s.customTag.toLowerCase())) {
    const ct = s.customTag.toLowerCase();
    if (VOID_TAGS.has(ct)) return wrap(`<${ct}${attrs} />`);
    return wrap(`<${ct}${attrs}>${typeof p.content === 'string' ? p.content : ''}${kids}</${ct}>`);
  }
  switch (node.type) {
    case 'section':
      return wrap(`<section${attrs}>${kids}</section>`);
    case 'heading': {
      const tag = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(String(s.tag)) ? String(s.tag) : 'h3';
      return wrap(`<${tag}${attrs}>${typeof p.text === 'string' ? p.text : ''}${kids}</${tag}>`);
    }
    case 'text':
      return wrap(`<div${attrs}>${typeof p.content === 'string' ? p.content : ''}${kids}</div>`);
    case 'button': {
      const href = typeof p.href === 'string' && p.href ? p.href : '#';
      const label = typeof p.label === 'string' ? p.label : '';
      // The reference puts the label in its own span, which is what carries the
      // button's type scale and letter-spacing.
      // The theme styles the label span, and that class is the THEME's, not
      // the old builder's — it stays.
      const body = `<span class="c-ip-button__text">${label}</span>`;
      return wrap(`<a${attrs.replace('class="', 'class="brxe-button ').replace('brxe-button brxe-', 'brxe-')} href="${esc(href)}" role="button">${body}</a>`);
    }
    case 'image': {
      const src = typeof p.src === 'string' ? p.src : '';
      return wrap(`<img${attrs} src="${esc(src)}" alt="${esc(typeof p.alt === 'string' ? p.alt : '')}" />`);
    }
    default:
      return wrap(`<div${attrs}>${kids}</div>`);
  }
}
