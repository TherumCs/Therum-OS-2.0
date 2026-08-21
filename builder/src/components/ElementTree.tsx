import { type ReactNode, type MouseEvent } from 'react';
import { useCanvas } from '../store/useCanvas.js';
import { REGISTRY } from '../lib/element-registry.js';
import type { CanvasNode } from '../lib/builder-types.js';

function Row({ node, depth }: { node: CanvasNode; depth: number }): ReactNode {
  const selectedId = useCanvas((s) => s.selectedId);
  const select = useCanvas((s) => s.select);
  const removeNode = useCanvas((s) => s.removeNode);
  const moveNode = useCanvas((s) => s.moveNode);
  const sel = selectedId === node.id;
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <>
      <div className={'tree-row' + (sel ? ' tree-sel' : '')} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => select(node.id)}>
        <span className="tree-glyph">{REGISTRY[node.type].glyph}</span>
        <span className="tree-label">{REGISTRY[node.type].label}</span>
        {node.id !== 'root' && (
          <span className="tree-actions">
            <button title="Move up" onClick={stop(() => moveNode(node.id, -1))}>↑</button>
            <button title="Move down" onClick={stop(() => moveNode(node.id, 1))}>↓</button>
            <button title="Delete" onClick={stop(() => removeNode(node.id))}>✕</button>
          </span>
        )}
      </div>
      {node.children.map((c) => (
        <Row key={c.id} node={c} depth={depth + 1} />
      ))}
    </>
  );
}

export function ElementTree(): ReactNode {
  const tree = useCanvas((s) => s.tree);
  return (
    <div className="panel">
      <div className="panel-title">Layers</div>
      <Row node={tree} depth={0} />
    </div>
  );
}
