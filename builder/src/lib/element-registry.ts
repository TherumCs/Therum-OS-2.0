import type { ElementDef, ElementType } from './builder-types.js';

// Schema-driven elements: the Inspector renders only an element's valid fields.
export const REGISTRY: Record<ElementType, ElementDef> = {
  section: {
    type: 'section',
    label: 'Section',
    glyph: '▭',
    canHaveChildren: true,
    fields: [
      { key: 'background', label: 'Background', kind: 'color' },
      { key: 'padding', label: 'Padding (px)', kind: 'number' },
      { key: 'maxWidth', label: 'Max width (px)', kind: 'number' },
    ],
    defaultProps: { background: '#ffffff', padding: 48, maxWidth: 1100 },
  },
  container: {
    type: 'container',
    label: 'Container',
    glyph: '▢',
    canHaveChildren: true,
    fields: [
      { key: 'direction', label: 'Direction', kind: 'select', options: ['column', 'row'] },
      { key: 'gap', label: 'Gap (px)', kind: 'number' },
      { key: 'align', label: 'Align', kind: 'select', options: ['flex-start', 'center', 'flex-end', 'stretch'] },
    ],
    defaultProps: { direction: 'column', gap: 16, align: 'stretch' },
  },
  heading: {
    type: 'heading',
    label: 'Heading',
    glyph: 'H',
    canHaveChildren: false,
    fields: [
      { key: 'text', label: 'Text', kind: 'text' },
      { key: 'level', label: 'Level', kind: 'select', options: ['h1', 'h2', 'h3'] },
      { key: 'color', label: 'Color', kind: 'color' },
      { key: 'align', label: 'Align', kind: 'select', options: ['left', 'center', 'right'] },
    ],
    defaultProps: { text: 'Headline', level: 'h2', color: '#0f172a', align: 'left' },
  },
  text: {
    type: 'text',
    label: 'Text',
    glyph: '¶',
    canHaveChildren: false,
    fields: [
      { key: 'content', label: 'Content', kind: 'textarea' },
      { key: 'color', label: 'Color', kind: 'color' },
      { key: 'size', label: 'Size (px)', kind: 'number' },
    ],
    defaultProps: { content: 'Some copy goes here.', color: '#475569', size: 16 },
  },
  button: {
    type: 'button',
    label: 'Button',
    glyph: '⬚',
    canHaveChildren: false,
    fields: [
      { key: 'label', label: 'Label', kind: 'text' },
      { key: 'href', label: 'Link', kind: 'url' },
      { key: 'background', label: 'Background', kind: 'color' },
      { key: 'color', label: 'Text color', kind: 'color' },
    ],
    defaultProps: { label: 'Shop now', href: '#', background: '#1d4e89', color: '#ffffff' },
  },
  image: {
    type: 'image',
    label: 'Image',
    glyph: '🖼',
    canHaveChildren: false,
    fields: [
      { key: 'src', label: 'Source URL', kind: 'url' },
      { key: 'alt', label: 'Alt text', kind: 'text' },
      { key: 'width', label: 'Width (px)', kind: 'number' },
    ],
    defaultProps: { src: 'https://placehold.co/600x360', alt: 'Image', width: 600 },
  },
  productList: {
    type: 'productList',
    label: 'Product list',
    glyph: '🛍',
    canHaveChildren: false,
    fields: [
      { key: 'limit', label: 'Max products', kind: 'number' },
      { key: 'columns', label: 'Columns', kind: 'number' },
    ],
    defaultProps: { limit: 6, columns: 3 },
  },
};

export const PALETTE: ElementType[] = ['section', 'container', 'heading', 'text', 'button', 'image', 'productList'];
