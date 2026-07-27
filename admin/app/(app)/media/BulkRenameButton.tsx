'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../lib/session';
import type { MediaItem } from './MediaTable';

interface Row {
  id: string;
  currentName: string;
}

interface RenameResult {
  id: string;
  ok: boolean;
  error?: string;
}

function filename(url: string): string {
  return url.split('/').pop() ?? url;
}

function basenameOf(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

// No modal pattern exists elsewhere in this codebase yet (everything so far
// is inline pages/panels or window.prompt/confirm) — this is a small,
// self-contained one rather than reaching for a dependency for one screen.
// Every locally-stored file is listed, pre-filled with its current name —
// there's no suggestion engine behind this, on purpose: type whatever you
// want each one to be, same as the single-item rename.
export function BulkRenameButton({ items }: { items: MediaItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<string, RenameResult> | null>(null);

  const rows: Row[] = items.filter((i) => i.url.includes('/api/uploads/')).map((i) => ({ id: i.id, currentName: filename(i.url) }));

  function openPanel() {
    setResults(null);
    setNames(Object.fromEntries(rows.map((r) => [r.id, basenameOf(r.currentName)])));
    setIncluded(Object.fromEntries(rows.map((r) => [r.id, false])));
    setOpen(true);
  }

  async function execute() {
    const toRename = rows.filter((r) => included[r.id]).map((r) => ({ id: r.id, basename: names[r.id] ?? basenameOf(r.currentName) }));
    if (!toRename.length) return;
    setRunning(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/media/bulk-rename`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: toRename }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { results: RenameResult[] };
      setResults(Object.fromEntries(data.results.map((r) => [r.id, r])));
      router.refresh();
    } catch (e) {
      window.alert(`Bulk rename failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  }

  const includedCount = rows.filter((r) => included[r.id]).length;

  return (
    <>
      <button type="button" className="th-btn" onClick={openPanel}>
        Bulk rename
      </button>
      {open && (
        <div className="th-modal-backdrop" onClick={() => !running && setOpen(false)}>
          <div className="th-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Bulk rename media">
            <div className="th-modal-header">
              <h2>Bulk rename</h2>
              <button type="button" className="th-modal-close" onClick={() => setOpen(false)} disabled={running} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="th-modal-body">
              {rows.length === 0 ? (
                <p className="muted">No locally-stored files to rename yet — upload something first.</p>
              ) : (
                <div className="th-bulk-list">
                  {rows.map((r) => (
                    <div key={r.id} className="th-bulk-row">
                      <input
                        type="checkbox"
                        checked={included[r.id] ?? false}
                        onChange={(e) => setIncluded((s) => ({ ...s, [r.id]: e.target.checked }))}
                        disabled={running}
                      />
                      <span className="th-bulk-current muted" title={r.currentName}>
                        {r.currentName}
                      </span>
                      <span className="th-bulk-arrow">→</span>
                      <input
                        className="th-bulk-name-input"
                        value={names[r.id] ?? ''}
                        onChange={(e) => setNames((s) => ({ ...s, [r.id]: e.target.value }))}
                        disabled={running}
                      />
                      {results?.[r.id] && (
                        <span className={results[r.id].ok ? 'th-bulk-ok' : 'th-bulk-err'}>{results[r.id].ok ? '✓' : results[r.id].error || 'Failed'}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {rows.length > 0 && (
              <div className="th-modal-footer">
                <span className="muted">{includedCount} selected</span>
                <button type="button" className="th-btn th-btn-primary" onClick={execute} disabled={running || includedCount === 0}>
                  {running ? 'Renaming…' : `Rename ${includedCount}`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
