import { create } from 'zustand';
import { REGISTRY } from '../lib/element-registry.js';
import { newId, type CanvasNode, type ElementType } from '../lib/builder-types.js';

function rootNode(): CanvasNode {
  return { id: 'root', type: 'section', props: { background: '#f8fafc', padding: 40, maxWidth: 1100 }, children: [] };
}

export function find(node: CanvasNode, id: string): CanvasNode | null {
  if (node.id === id) return node;
  for (const c of node.children) {
    const f = find(c, id);
    if (f) return f;
  }
  return null;
}

function findParent(node: CanvasNode, id: string): CanvasNode | null {
  for (const c of node.children) {
    if (c.id === id) return node;
    const f = findParent(c, id);
    if (f) return f;
  }
  return null;
}

interface CanvasState {
  tree: CanvasNode;
  selectedId: string | null;
  past: CanvasNode[];
  future: CanvasNode[];
  select: (id: string | null) => void;
  addElement: (type: ElementType, parentId?: string) => void;
  updateProps: (id: string, patch: Record<string, unknown>) => void;
  removeNode: (id: string) => void;
  moveNode: (id: string, dir: -1 | 1) => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
  setTree: (tree: CanvasNode) => void;
}

export const useCanvas = create<CanvasState>((set, get) => {
  const commit = (mutate: (draft: CanvasNode) => void, selectId?: string | null): void => {
    const { tree, past } = get();
    const draft = structuredClone(tree);
    mutate(draft);
    set({
      tree: draft,
      past: [...past, tree].slice(-50),
      future: [],
      ...(selectId !== undefined ? { selectedId: selectId } : {}),
    });
  };

  return {
    tree: rootNode(),
    selectedId: 'root',
    past: [],
    future: [],

    select: (id) => set({ selectedId: id }),

    addElement: (type, parentId) => {
      const def = REGISTRY[type];
      const node: CanvasNode = { id: newId(), type, props: { ...def.defaultProps }, children: [] };
      commit((draft) => {
        const { selectedId } = get();
        let target: CanvasNode | null = parentId ? find(draft, parentId) : selectedId ? find(draft, selectedId) : draft;
        if (!target || !REGISTRY[target.type].canHaveChildren) {
          const parent = target ? findParent(draft, target.id) : null;
          target = parent && REGISTRY[parent.type].canHaveChildren ? parent : draft;
        }
        target.children.push(node);
      }, node.id);
    },

    updateProps: (id, patch) =>
      commit((draft) => {
        const n = find(draft, id);
        if (n) n.props = { ...n.props, ...patch };
      }),

    removeNode: (id) => {
      if (id === 'root') return;
      commit((draft) => {
        const parent = findParent(draft, id);
        if (parent) parent.children = parent.children.filter((c) => c.id !== id);
      }, 'root');
    },

    moveNode: (id, dir) =>
      commit((draft) => {
        const parent = findParent(draft, id);
        if (!parent) return;
        const i = parent.children.findIndex((c) => c.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= parent.children.length) return;
        const a = parent.children[i]!;
        const b = parent.children[j]!;
        parent.children[i] = b;
        parent.children[j] = a;
      }),

    undo: () => {
      const { past, tree, future } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      set({ tree: prev, past: past.slice(0, -1), future: [tree, ...future] });
    },

    redo: () => {
      const { future, tree, past } = get();
      const next = future[0];
      if (!next) return;
      set({ tree: next, future: future.slice(1), past: [...past, tree] });
    },

    reset: () => set({ tree: rootNode(), selectedId: 'root', past: [], future: [] }),

    setTree: (tree) => {
      const { tree: current, past } = get();
      set({ tree, selectedId: 'root', past: [...past, current].slice(-50), future: [] });
    },
  };
});
