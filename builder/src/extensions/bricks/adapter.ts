import type { CanvasNode, ElementType } from '../../lib/builder-types.js';

// Bricks stores a page as a FLAT array of elements (parent 0 = top level).
// Our canvas is a NESTED tree. This adapter converts both ways so a 2.0 site
// can ingest existing Bricks pages and emit Bricks-format content back.
export interface BricksElement {
  id: string;
  name: string;
  parent: string | 0;
  children: string[];
  settings: Record<string, unknown>;
}

const BRICKS_TO_TYPE: Record<string, ElementType> = {
  section: 'section',
  container: 'container',
  block: 'container',
  div: 'container',
  heading: 'heading',
  'text-basic': 'text',
  text: 'text',
  button: 'button',
  image: 'image',
  'woocommerce-products': 'productList',
};

const TYPE_TO_BRICKS: Record<ElementType, string> = {
  section: 'section',
  container: 'container',
  heading: 'heading',
  text: 'text-basic',
  button: 'button',
  image: 'image',
  productList: 'woocommerce-products',
};

function bricksId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function settingsToProps(type: ElementType, s: Record<string, unknown>): Record<string, unknown> {
  // Preserve the raw Bricks settings so a round-trip is lossless for keys we
  // don't surface in our inspector (styling, conditions, interactions…).
  const props: Record<string, unknown> = { __bricks: s };
  switch (type) {
    case 'heading':
      props.text = typeof s.text === 'string' ? s.text : 'Heading';
      props.level = s.tag === 'h1' || s.tag === 'h2' || s.tag === 'h3' ? s.tag : 'h2';
      break;
    case 'text':
      props.content = typeof s.text === 'string' ? s.text : '';
      break;
    case 'button':
      props.label = typeof s.text === 'string' ? s.text : 'Button';
      props.href = typeof asRecord(s.link).url === 'string' ? (asRecord(s.link).url as string) : '#';
      break;
    case 'image':
      props.src = typeof asRecord(s.image).url === 'string' ? (asRecord(s.image).url as string) : '';
      props.alt = typeof asRecord(s.image).alt === 'string' ? (asRecord(s.image).alt as string) : '';
      break;
    default:
      break;
  }
  return props;
}

function propsToSettings(node: CanvasNode): Record<string, unknown> {
  const base = { ...asRecord(node.props.__bricks) };
  const p = node.props;
  switch (node.type) {
    case 'heading':
      base.text = p.text;
      base.tag = p.level;
      break;
    case 'text':
      base.text = p.content;
      break;
    case 'button':
      base.text = p.label;
      if (p.href) base.link = { type: 'external', url: p.href };
      break;
    case 'image':
      if (p.src) base.image = { ...asRecord(base.image), url: p.src, alt: p.alt };
      break;
    default:
      break;
  }
  return base;
}

// Bricks flat array → our nested canvas tree (wrapped in a root section).
export function fromBricks(elements: BricksElement[]): CanvasNode {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const build = (el: BricksElement): CanvasNode => {
    const type = BRICKS_TO_TYPE[el.name] ?? (el.children.length ? 'container' : 'text');
    const children = el.children
      .map((cid) => byId.get(cid))
      .filter((c): c is BricksElement => Boolean(c))
      .map(build);
    return { id: el.id || bricksId(), type, props: settingsToProps(type, el.settings), children };
  };
  const roots = elements.filter((e) => e.parent === 0 || e.parent === '0' || !byId.has(String(e.parent)));
  return { id: 'root', type: 'section', props: { background: '#ffffff', padding: 40, maxWidth: 1100 }, children: roots.map(build) };
}

// Our canvas tree → Bricks flat array (the synthetic root's children are top level).
export function toBricks(root: CanvasNode): BricksElement[] {
  const out: BricksElement[] = [];
  const emit = (node: CanvasNode, parent: string | 0): string => {
    const id = node.id && node.id !== 'root' ? node.id : bricksId();
    const childIds = node.children.map((c) => emit(c, id));
    out.push({ id, name: TYPE_TO_BRICKS[node.type], parent, children: childIds, settings: propsToSettings(node) });
    return id;
  };
  for (const c of root.children) emit(c, 0);
  return out;
}
