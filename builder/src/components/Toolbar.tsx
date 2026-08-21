import type { ReactNode } from 'react';
import { useCanvas } from '../store/useCanvas.js';
import { REGISTRY, PALETTE } from '../lib/element-registry.js';
import { serialize } from '../lib/serialize.js';
import { useContent } from '../store/useContent.js';
import { useEnabledExtensions } from '../extensions/registry.js';

function download(data: string, name: string, mime: string): void {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function Toolbar(): ReactNode {
  const addElement = useCanvas((s) => s.addElement);
  const undo = useCanvas((s) => s.undo);
  const redo = useCanvas((s) => s.redo);
  const tree = useCanvas((s) => s.tree);
  const past = useCanvas((s) => s.past);
  const future = useCanvas((s) => s.future);
  const contentId = useContent((s) => s.id);
  const saveToFolio = useContent((s) => s.save);
  const saveStatus = useContent((s) => s.status);
  // Core has no idea Bricks exists — it just renders whatever enabled
  // extensions contribute (matches the `Extension` model on the backend).
  const extensions = useEnabledExtensions();

  const exportHtml = (): void => download(serialize(tree), 'page.html', 'text/html');

  return (
    <div className="toolbar">
      <div className="palette">
        {PALETTE.map((t) => (
          <button key={t} className="pal-btn" onClick={() => addElement(t)} title={`Add ${REGISTRY[t].label}`}>
            <span className="pal-glyph">{REGISTRY[t].glyph}</span>
            {REGISTRY[t].label}
          </button>
        ))}
      </div>
      <div className="tb-right">
        <button onClick={undo} disabled={!past.length}>
          Undo
        </button>
        <button onClick={redo} disabled={!future.length}>
          Redo
        </button>
        {extensions.map((ext) => (ext.ToolbarExtra ? <ext.ToolbarExtra key={ext.id} /> : null))}
        <button onClick={exportHtml}>Export HTML</button>
        {contentId && (
          <button className="primary" onClick={() => void saveToFolio()} disabled={saveStatus === 'saving'}>
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : 'Save to Folio'}
          </button>
        )}
      </div>
    </div>
  );
}
