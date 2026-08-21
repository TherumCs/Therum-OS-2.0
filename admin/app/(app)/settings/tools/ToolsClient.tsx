'use client';
import { useState } from 'react';
import { BASE_PATH } from '../../../../lib/session';

interface FindReplaceMatch {
  id: string;
  title: string;
  field: 'title' | 'excerpt';
}

export function FindReplaceTool() {
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [preview, setPreview] = useState<{ count: number; samples: FindReplaceMatch[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function runPreview(): Promise<void> {
    if (!find.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/tools/find-replace/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ find, replace }),
      });
      setPreview(await res.json());
    } finally {
      setBusy(false);
    }
  }

  async function runExecute(): Promise<void> {
    if (!preview?.count) return;
    setBusy(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/tools/find-replace/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ find, replace }),
      });
      const body = (await res.json()) as { updated: number };
      setResult(`Replaced in ${body.updated} item(s).`);
      setPreview(null);
      setFind('');
      setReplace('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--th-space-8)', flexWrap: 'wrap', marginBottom: 'var(--th-space-12)' }}>
        <input className="settings-text-input" placeholder="Find" value={find} onChange={(e) => setFind(e.target.value)} />
        <input className="settings-text-input" placeholder="Replace" value={replace} onChange={(e) => setReplace(e.target.value)} />
        <button type="button" onClick={() => void runPreview()} disabled={busy || !find.trim()}>
          Preview matches
        </button>
        {!!preview?.count && (
          <button type="button" onClick={() => void runExecute()} disabled={busy}>
            Replace all
          </button>
        )}
      </div>
      {preview && (
        // A <div>, not <p> — a <ul> can't validly nest inside a <p> (React
        // hydration warning: "<ul> cannot be a descendant of <p>").
        <div className="muted" style={{ fontSize: 'var(--th-fs-sm)' }}>
          {preview.count} match{preview.count === 1 ? '' : 'es'} in page/post titles and excerpts.
          {preview.samples.length > 0 && (
            <ul style={{ margin: 'var(--th-space-6) 0 0', paddingLeft: 'var(--th-space-20)' }}>
              {preview.samples.map((s) => (
                <li key={`${s.id}-${s.field}`}>
                  {s.title} <span className="muted">({s.field})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {result && <p style={{ fontSize: 'var(--th-fs-sm)' }}>{result}</p>}
    </div>
  );
}
