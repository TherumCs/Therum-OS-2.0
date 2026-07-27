// Bricks Bridge (Studio App) — server-side Bricks ⇄ canvas adapter.
// "Use Bricks without full-blown WordPress": design in Bricks anywhere,
// export, import here → the page becomes NATIVE canvas (editable in the
// Therum Builder, rendered by the existing server renderer). Mirrors the
// builder's own adapter (builder/src/extensions/bricks/adapter.ts) — same
// mapping, same lossless __bricks raw-settings preservation — kept as its
// own copy because backend and builder are separate compile roots.
//
// Verified against the REAL Bricks theme source (v1.x, local install):
// - postmeta `_bricks_page_content_2` = flat element array
// - template export JSON = { content: [elements], templateType, … }
// - builder clipboard = { source: 'bricksCopiedElements', content: […] }
// All three shapes are accepted by parseBricksPayload().

export interface BricksElement {
  id: string;
  name: string;
  parent: string | 0;
  children: string[];
  settings: Record<string, unknown>;
}

export interface CanvasNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children: CanvasNode[];
}

// Element map — the canvas types the server renderer supports. Everything
// unmapped degrades gracefully: has children → container, else text (with
// the raw settings preserved for a lossless round-trip back out).
const BRICKS_TO_TYPE: Record<string, string> = {
  section: 'section',
  container: 'container',
  block: 'container',
  div: 'container',
  heading: 'heading',
  'text-basic': 'text',
  text: 'text',
  'text-link': 'text',
  button: 'button',
  image: 'image',
  video: 'image', // rendered as poster/image until the canvas grows a video element
  divider: 'text',
  'woocommerce-products': 'productList',
};

const TYPE_TO_BRICKS: Record<string, string> = {
  section: 'section',
  container: 'container',
  heading: 'heading',
  text: 'text-basic',
  button: 'button',
  image: 'image',
  productList: 'woocommerce-products',
};

let seq = 0;
function bricksId(): string {
  seq += 1;
  return `thb${seq.toString(36)}${(seq * 7919).toString(36)}`.slice(0, 6);
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function settingsToProps(type: string, s: Record<string, unknown>): Record<string, unknown> {
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
      props.src = typeof asRecord(s.image).url === 'string' ? (asRecord(s.image).url as string) : typeof asRecord(s.videoPoster).url === 'string' ? (asRecord(s.videoPoster).url as string) : '';
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

// Accept any of the three real Bricks payload shapes → flat element array.
export function parseBricksPayload(payload: unknown): BricksElement[] {
  const isElementArray = (v: unknown): v is BricksElement[] =>
    Array.isArray(v) && v.every((e) => e && typeof e === 'object' && typeof (e as BricksElement).name === 'string' && 'settings' in (e as object));
  if (isElementArray(payload)) return payload;
  const rec = asRecord(payload);
  if (isElementArray(rec.content)) return rec.content; // template export / clipboard
  if (Array.isArray(rec.templates)) {
    const first = asRecord(rec.templates[0]);
    if (isElementArray(first.content)) return first.content; // remote-templates API shape
  }
  throw new Error('Not a recognizable Bricks payload — expected a flat element array, a template export ({content: […]}), or builder clipboard data.');
}

export function fromBricks(elements: BricksElement[]): CanvasNode {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const build = (el: BricksElement): CanvasNode => {
    const type = BRICKS_TO_TYPE[el.name] ?? ((el.children?.length ?? 0) > 0 ? 'container' : 'text');
    const children = (el.children ?? [])
      .map((cid) => byId.get(cid))
      .filter((c): c is BricksElement => Boolean(c))
      .map(build);
    const props = settingsToProps(type, asRecord(el.settings));
    props.__name = el.name;
    return { id: el.id || bricksId(), type, props, children };
  };
  const roots = elements.filter((e) => e.parent === 0 || String(e.parent) === '0' || !byId.has(String(e.parent)));
  return { id: 'root', type: 'section', props: { background: '#ffffff', padding: 40, maxWidth: 1100 }, children: roots.map(build) };
}

export function toBricks(root: CanvasNode): BricksElement[] {
  const out: BricksElement[] = [];
  const emit = (node: CanvasNode, parent: string | 0): string => {
    const id = node.id && node.id !== 'root' ? node.id : bricksId();
    const childIds = (node.children ?? []).map((c) => emit(c, id));
    out.push({ id, name: TYPE_TO_BRICKS[node.type] ?? 'div', parent, children: childIds, settings: propsToSettings(node) });
    return id;
  };
  for (const c of root.children ?? []) emit(c, 0);
  return out;
}
