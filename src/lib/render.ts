// Renders a builder canvas tree to HTML — the publish-time half of the
// builder↔Folio loop. Mirrors builder/src/lib/serialize.ts (keep in sync).
import { PORTED_ELEMENT_CLASSES } from '../site/portedElementClasses.js';
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

// Elementor names each element's class `elementor-element-<id>` and generates
// its whole layout stylesheet against that name — widths, padding, flex, the
// lot. Our WP import shortened it to `el-<id>`, which kept the ids but severed
// every rule that styles them: the home page carried 63 such elements and not
// one matched, so the layout fell back to generic container defaults and
// rendered narrow and unstyled.
//
// Restore the name the stylesheet is written against. The short form stays so
// anything already keyed to it keeps working, and non-Elementor classes are
// untouched — only the exact `el-<7-or-more hex>` shape is expanded.
// The id alone is still not enough. Elementor's per-element rules set only
// CUSTOM PROPERTIES — `--min-height`, `--display`, `--flex-direction` — and
// nothing reads them until the element also carries the structural class the
// base stylesheet declares them on:
//
//     .e-con { min-height: var(--min-height); ... }
//
// Without `e-con` a section that declares `--min-height:100vh` renders at its
// content height, which is why the ported heroes came out 242px instead of
// 900px. Elementor splits every element into exactly two kinds — a container
// (`e-con`) or a widget (`elementor-widget-<type>`) — so that is the split
// reproduced here, keyed off the Bricks element name the import wrote.
const ELEMENTOR_ID = /^el-([0-9a-f]{7,})$/;
const CONTAINER_NAMES = new Set(['container', 'section', 'block']);

export function expandElementorIds(cssClasses: string, name: string): string {
  return cssClasses
    .split(/\s+/)
    .filter(Boolean)
    .map((c) => {
      const m = ELEMENTOR_ID.exec(c);
      if (!m) return c;
      const id = m[1]!;
      const base = `${c} elementor-element elementor-element-${id}`;
      // The reference's own class list wins whenever we have it. Deriving the
      // widget name from our element name produced `elementor-widget-button`
      // where the stylesheet says `elementor-widget-ideapark-button`, so no
      // rule matched and the button rendered at content width.
      const known = PORTED_ELEMENT_CLASSES[id];
      if (known) return `${base} ${known}`;
      // No entry means the reference has no such element: the conversion
      // invented this node. Seven of them sit in the home page's hero, and as
      // empty flex children they were eating the row — one took 475px, which
      // squeezed the two real buttons from 306px and 177px down to 176px and
      // 102px and wrapped their labels onto a second line.
      //
      // `th-no-ref` lets the stylesheet take them out of layout without
      // deleting anything: the node and its children stay in the DOM, it just
      // stops generating a box of its own. Removing a box the reference never
      // had can only move us toward it.
      return `${base} th-no-ref ${CONTAINER_NAMES.has(name) ? 'e-con e-flex e-con-full' : 'elementor-widget'}`;
    })
    .join(' ');
}

// The reference wraps every widget in three layers, and the theme's rules
// target the INNERMOST one:
//
//   div.elementor-widget.elementor-widget-ideapark-button
//     div.elementor-widget-container
//       div.c-ip-button__wrap
//         a.c-button.c-ip-button.c-button--outline   <- every button rule is here
//           span.c-ip-button__text
//
// Our import flattened all of that into a single <a> carrying the WRAPPER's
// classes, so `.c-ip-button` never existed on the page and not one button rule
// could match. The hero buttons rendered at their text width — 143px against
// the reference's 306px — and the logo and scroll arrow shrank the same way.
//
// Rebuilding the layers is what makes the imported stylesheet apply. Shapes are
// read off the reference markup, per Forge's source-router rule; a widget type
// not listed still gets the wrapper, which is the part Elementor's own layout
// rules need.
const WIDGET_SHAPE: Record<string, { open: string; close: string; innerClass: string }> = {
  'ideapark-button': {
    open: '<div class="elementor-widget-container"><div class="c-ip-button__wrap">',
    close: '</div></div>',
    innerClass: 'c-button c-ip-button c-button--outline',
  },
  heading: { open: '', close: '', innerClass: 'elementor-heading-title elementor-size-default' },
  image: { open: '', close: '', innerClass: 'attachment-full size-full' },
  'text-editor': { open: '<div class="elementor-widget-container">', close: '</div>', innerClass: '' },
};

// The real widget type, ignoring the width modifiers that share the prefix
// (`elementor-widget__width-initial`, `elementor-widget-tablet__width-auto`).
function widgetTypeOf(classes: string): string | null {
  const t = classes.split(/\s+/).find((c) => c.startsWith('elementor-widget-') && !c.includes('__'));
  return t ? t.slice('elementor-widget-'.length) : null;
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
  // A widget's Elementor classes belong on the wrapper this renderer adds
  // below, not on the element itself; putting them on the element is what left
  // the theme's inner classes with nowhere to live.
  // ONLY wrap widget types whose real structure was read off the reference.
  // Injecting a generic `elementor-widget-container` for the rest guessed at a
  // layer that is not always there: the running-line marquee has none, so the
  // injected box landed inside the scrolling strip as a 9th flex child sitting
  // on top of the text — the reference has exactly one child there. A widget
  // with no verified shape keeps its classes on the element, as before.
  const widgetType = expanded ? widgetTypeOf(expanded) : null;
  const shape = widgetType ? WIDGET_SHAPE[widgetType] : undefined;
  const widget = shape ? widgetType : null;
  // A BOXED container carries its width on an inner element, not on itself:
  //   .e-con { --content-width: min(100%, var(--container-max-width,1140px)) }
  //   .e-con-boxed > .e-con-inner { width: var(--content-width) }
  // We emitted the container and no inner, so nothing constrained the content
  // and the About page ran 1360px wide against the reference's 1170px — which
  // is every one of that page's 391 width findings, one missing element.
  const boxed = expanded.includes('e-con-boxed');
  const kids = boxed ? `<div class="e-con-inner">${rawKids}</div>` : rawKids;
  if (expanded && !widget) classes.push(expanded);
  if (shape?.innerClass) classes.push(shape.innerClass);
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
  const attrs = widget
    ? ` class="${esc(classes.join(' '))}"${style}${extra}`
    : ` id="${idAttr}" class="${esc(classes.join(' '))}"${style}${extra}`;
  const wrap = (inner: string): string =>
    widget
      ? `<div id="${idAttr}" class="${esc(expanded)}">${shape?.open ?? '<div class="elementor-widget-container">'}${inner}${shape?.close ?? '</div>'}</div>`
      : inner;
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
      const body = widget === 'ideapark-button' ? `<span class="c-ip-button__text">${label}</span>` : label;
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
