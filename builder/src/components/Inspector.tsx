import { type ReactNode, type ChangeEvent } from 'react';
import { useCanvas, find } from '../store/useCanvas.js';
import { REGISTRY } from '../lib/element-registry.js';

export function Inspector(): ReactNode {
  const tree = useCanvas((s) => s.tree);
  const selectedId = useCanvas((s) => s.selectedId);
  const updateProps = useCanvas((s) => s.updateProps);
  const node = selectedId ? find(tree, selectedId) : null;

  if (!node) {
    return (
      <div className="panel">
        <div className="panel-title">Inspector</div>
        <div className="muted">Select an element to edit it.</div>
      </div>
    );
  }

  const def = REGISTRY[node.type];
  const set = (key: string, value: unknown): void => updateProps(node.id, { [key]: value });

  return (
    <div className="panel">
      <div className="panel-title">Inspector · {def.label}</div>
      {def.fields.map((f) => {
        const val = node.props[f.key];
        const onChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>): void =>
          set(f.key, f.kind === 'number' ? Number(e.target.value) : e.target.value);
        return (
          <label className="field" key={f.key}>
            <span>{f.label}</span>
            {f.kind === 'textarea' ? (
              <textarea value={String(val ?? '')} onChange={onChange} rows={3} />
            ) : f.kind === 'select' ? (
              <select value={String(val ?? '')} onChange={onChange}>
                {f.options?.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : f.kind === 'color' ? (
              <input type="color" value={String(val ?? '#000000')} onChange={onChange} />
            ) : f.kind === 'number' ? (
              <input type="number" value={Number(val) || 0} onChange={onChange} />
            ) : (
              <input type="text" value={String(val ?? '')} onChange={onChange} />
            )}
          </label>
        );
      })}
    </div>
  );
}
