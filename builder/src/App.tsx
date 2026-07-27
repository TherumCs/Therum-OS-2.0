import { useEffect, type ReactNode } from 'react';
import { Toolbar } from './components/Toolbar.js';
import { ElementTree } from './components/ElementTree.js';
import { Canvas } from './components/Canvas.js';
import { Inspector } from './components/Inspector.js';
import { useContent } from './store/useContent.js';

export function App(): ReactNode {
  const init = useContent((s) => s.init);
  const cid = useContent((s) => s.id);
  const title = useContent((s) => s.title);
  const status = useContent((s) => s.status);
  const message = useContent((s) => s.message);
  useEffect(() => {
    init();
  }, [init]);
  return (
    <div className="app">
      <header className="app-header">
        <strong>Therum Builder</strong>
        {cid ? (
          <span className="muted">
            Editing Folio · {title || cid}
            {status === 'loading' ? ' · loading…' : status === 'error' ? ' · ' + message : ''}
          </span>
        ) : (
          <span className="muted">Phase 3 · canvas + inspector + live API data</span>
        )}
      </header>
      <Toolbar />
      <div className="workspace">
        <aside className="left">
          <ElementTree />
        </aside>
        <main className="center">
          <Canvas />
        </main>
        <aside className="right">
          <Inspector />
        </aside>
      </div>
    </div>
  );
}
