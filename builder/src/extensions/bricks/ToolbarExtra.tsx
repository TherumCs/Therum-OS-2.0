import type { ReactNode } from 'react';
import { useCanvas } from '../../store/useCanvas.js';
import { fromBricks, toBricks, type BricksElement } from './adapter.js';

function download(data: string, name: string, mime: string): void {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// Self-contained toolbar contribution — the core Toolbar never imports Bricks
// logic directly; it just renders whichever enabled extensions provide.
export function ToolbarExtra(): ReactNode {
  const tree = useCanvas((s) => s.tree);
  const setTree = useCanvas((s) => s.setTree);

  const exportBricks = (): void => download(JSON.stringify(toBricks(tree), null, 2), 'page.bricks.json', 'application/json');

  const importBricks = (): void => {
    const raw = window.prompt('Paste Bricks element JSON (array or { content: [...] }):');
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      const els = (Array.isArray(parsed) ? parsed : (parsed as { content?: unknown }).content) as BricksElement[] | undefined;
      if (!Array.isArray(els)) throw new Error('expected an array of Bricks elements');
      setTree(fromBricks(els));
    } catch (e) {
      window.alert('Could not import Bricks JSON: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <>
      <button onClick={importBricks}>Import Bricks</button>
      <button onClick={exportBricks}>Export Bricks</button>
    </>
  );
}
