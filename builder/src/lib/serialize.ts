import type { CanvasNode } from './builder-types.js';

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ENT[c] ?? c);
const num = (v: unknown, d: number): number => (Number.isFinite(Number(v)) ? Number(v) : d);

export function serialize(node: CanvasNode): string {
  const p = node.props;
  const kids = node.children.map(serialize).join('');
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
  }
}
