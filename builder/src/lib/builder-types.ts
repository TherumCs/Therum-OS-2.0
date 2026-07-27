export type ElementType =
  | 'section'
  | 'container'
  | 'heading'
  | 'text'
  | 'button'
  | 'image'
  | 'productList';

export interface CanvasNode {
  id: string;
  type: ElementType;
  props: Record<string, unknown>;
  children: CanvasNode[];
}

export type FieldKind = 'text' | 'textarea' | 'number' | 'color' | 'select' | 'url';

export interface PropField {
  key: string;
  label: string;
  kind: FieldKind;
  options?: readonly string[];
}

export interface ElementDef {
  type: ElementType;
  label: string;
  glyph: string;
  canHaveChildren: boolean;
  fields: readonly PropField[];
  defaultProps: Record<string, unknown>;
}

export function newId(): string {
  return crypto.randomUUID();
}
