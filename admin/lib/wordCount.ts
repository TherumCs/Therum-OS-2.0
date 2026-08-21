// Content-agnostic word count. 1.9.44 had to special-case Bricks pages
// (post_content is empty; the real text is buried in serialized element
// settings) — Folio's canvas body is the same shape of problem, so this
// walks the tree instead of assuming a flat text field ever exists.

interface CanvasLike {
  type?: string;
  props?: Record<string, unknown>;
  children?: CanvasLike[];
}

function collectCanvasText(node: CanvasLike, out: string[]): void {
  const p = node.props ?? {};
  if (typeof p.text === 'string') out.push(p.text);
  if (typeof p.content === 'string') out.push(p.content);
  if (typeof p.label === 'string') out.push(p.label);
  for (const child of node.children ?? []) collectCanvasText(child, out);
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export interface WordCountable {
  excerpt?: string | null;
  body?: unknown;
  bodyFormat?: string | null;
}

export function wordCount(item: WordCountable): number {
  if (item.excerpt && item.excerpt.trim()) return countWords(item.excerpt);

  if (item.bodyFormat === 'canvas' && item.body && typeof item.body === 'object') {
    const parts: string[] = [];
    collectCanvasText(item.body as CanvasLike, parts);
    const joined = parts.join(' ');
    return joined.trim() ? countWords(joined) : 0;
  }

  if (typeof item.body === 'string' && item.body.trim()) {
    return countWords(item.body.replace(/<[^>]+>/g, ' ')); // html, or markdown left raw
  }

  return 0;
}
