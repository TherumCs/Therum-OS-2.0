'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../../lib/session';

// The importer, in two steps: read the file, then agree what its columns mean.
//
// The mapping step is the entire point. Every catalogue names its columns
// differently, and an importer that demands its own header names makes you
// rewrite the file before it will read a line of it. Here the file is read as
// it is, each column is given a best guess, and nothing is written until those
// guesses have been looked at.

type TargetField = 'name' | 'description' | 'price' | 'sku' | 'image' | 'category' | 'tags' | 'status' | 'stock' | 'ignore';

interface Analysis {
  kind?: 'delimited' | 'xlsx' | 'pdf';
  headers: string[];
  suggested: TargetField[];
  sample: string[][];
  totalRows: number;
  delimiter?: string;
  fields: { id: TargetField; label: string; hint: string }[];
  /** PDF and spreadsheet rows are extracted server-side and handed back. */
  rows?: string[][];
  images?: { page: number; index: number; dataUrl: string }[];
  notes?: string[];
}

interface Result {
  created: number;
  updated: number;
  skipped: number;
  imagesImported: number;
  errors: { row: number; message: string }[];
}

export function ImportClient() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [rows, setRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<TargetField[]>([]);
  const [withImages, setWithImages] = useState(true);
  const [onDuplicate, setOnDuplicate] = useState<'skip' | 'update'>('skip');
  const [defaultStatus, setDefaultStatus] = useState<'draft' | 'active'>('draft');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  async function analyse(raw: string, name: string): Promise<void> {
    setError('');
    setResult(null);
    setBusy(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/catalog-import/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: raw }),
      });
      if (!res.ok) throw new Error(await res.text());
      const a = (await res.json()) as Analysis;
      if (!a.headers.length) throw new Error('No columns found — is this a delimited file?');
      setText(raw);
      setRows(null);
      setFileName(name);
      setAnalysis(a);
      setMapping(a.suggested);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    }
    setBusy(false);
  }

  // Every file goes to the server. A PDF or a spreadsheet cannot be read as
  // text in the browser, and having one path for all three means the mapping
  // step behaves identically whatever the source was.
  async function onFile(file: File): Promise<void> {
    setError('');
    setResult(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${BASE_PATH}/api/catalog-import/upload`, { method: 'POST', body: form });
      const body = (await res.json()) as Analysis & { error?: { message?: string } | string };
      if (!res.ok) {
        const msg = typeof body.error === 'string' ? body.error : body.error?.message;
        throw new Error(msg ?? 'Could not read that file.');
      }
      setText('');
      setRows(body.rows ?? null);
      setFileName(file.name);
      setAnalysis(body);
      setMapping(body.suggested);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    }
    setBusy(false);
  }

  async function run(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${BASE_PATH}/api/catalog-import/commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...(rows ? { rows } : { text }), mapping, withImages, onDuplicate, defaultStatus }),
      });
      if (!res.ok) throw new Error(await res.text());
      setResult((await res.json()) as Result);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    }
    setBusy(false);
  }

  const hasName = mapping.includes('name');

  if (result) {
    return (
      <div style={{ marginTop: 20 }}>
        <h2 style={{ marginBottom: 8 }}>Import finished</h2>
        <p className="th-hint">
          <strong>{result.created}</strong> created · <strong>{result.updated}</strong> updated ·{' '}
          <strong>{result.skipped}</strong> skipped · <strong>{result.imagesImported}</strong> images stored locally.
        </p>
        {result.errors.length > 0 && (
          <>
            {/* Row-level failures are listed rather than summarised: "12 rows
                failed" is not something you can act on. */}
            <p className="th-hint" style={{ marginTop: 12 }}>{result.errors.length} row(s) could not be imported:</p>
            <ul className="th-hint">
              {result.errors.slice(0, 20).map((e) => (
                <li key={e.row}>Row {e.row}: {e.message}</li>
              ))}
            </ul>
          </>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <a className="th-btn th-btn-primary" href="/products">See the products</a>
          <button type="button" className="th-btn" onClick={() => { setResult(null); setAnalysis(null); setText(''); setRows(null); setFileName(''); }}>
            Import another file
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 20 }}>
      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}

      {!analysis && (
        <>
          <label className="th-btn th-btn-primary" style={{ display: 'inline-block', cursor: 'pointer' }}>
            Choose a file
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain,.pdf,application/pdf,.xlsx,.xls"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
            />
          </label>
          <p className="th-hint" style={{ marginTop: 10 }}>
            CSV, TSV, semicolon-separated, Excel (<code>.xlsx</code>) or PDF. Delimiters are detected, quoted
            fields and embedded commas survive, European decimals (<code>1.299,00</code>) are understood, and a
            tabular PDF is read into columns.
          </p>
          <details style={{ marginTop: 16 }}>
            <summary className="th-hint" style={{ cursor: 'pointer' }}>…or paste the rows directly</summary>
            <textarea
              rows={8}
              style={{ width: '100%', marginTop: 10, fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
              placeholder={'name,price,image\nYuzu Kit Kat,3.50,https://…/yuzu.jpg'}
              onBlur={(e) => { if (e.target.value.trim()) void analyse(e.target.value, 'pasted rows'); }}
            />
          </details>
        </>
      )}

      {analysis && (
        <>
          <p className="th-hint">
            <strong>{fileName}</strong> — {analysis.totalRows} row{analysis.totalRows === 1 ? '' : 's'},{' '}
            {analysis.headers.length} columns. Check what each column means before importing.
          </p>

          {analysis.notes?.map((n) => (
            <p key={n} className="th-hint" style={{ marginTop: 8 }}>{n}</p>
          ))}
          {!!analysis.images?.length && (
            <div style={{ marginTop: 12 }}>
              <p className="th-hint">{analysis.images.length} image(s) found in the file, in page order:</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                {analysis.images.slice(0, 12).map((img) => (
                  <img
                    key={`${img.page}-${img.index}`}
                    src={img.dataUrl}
                    alt={`Page ${img.page}, image ${img.index + 1}`}
                    style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--th-line)' }}
                  />
                ))}
              </div>
            </div>
          )}

          <table style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th>Column in your file</th>
                <th>Becomes</th>
                <th>First value</th>
              </tr>
            </thead>
            <tbody>
              {analysis.headers.map((h, i) => (
                <tr key={`${h}-${i}`}>
                  <td><code>{h || <em>(unnamed)</em>}</code></td>
                  <td>
                    <select
                      value={mapping[i] ?? 'ignore'}
                      aria-label={`What ${h} becomes`}
                      onChange={(e) => setMapping((m) => m.map((v, j) => (j === i ? (e.target.value as TargetField) : v)))}
                    >
                      {analysis.fields.map((f) => (
                        <option key={f.id} value={f.id}>{f.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="th-hint" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {analysis.sample[0]?.[i] ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', marginTop: 18 }}>
            <label className="th-hint">
              <input type="checkbox" checked={withImages} onChange={(e) => setWithImages(e.target.checked)} />{' '}
              Download images into Media
            </label>
            <label className="th-hint">
              If a product already exists{' '}
              <select value={onDuplicate} onChange={(e) => setOnDuplicate(e.target.value as 'skip' | 'update')}>
                <option value="skip">leave it alone</option>
                <option value="update">update it from the file</option>
              </select>
            </label>
            <label className="th-hint">
              Import as{' '}
              <select value={defaultStatus} onChange={(e) => setDefaultStatus(e.target.value as 'draft' | 'active')}>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
              </select>
            </label>
          </div>

          {!hasName && (
            <div className="notice" style={{ marginTop: 14 }}>
              One column has to be the product <strong>Name</strong> — nothing can be identified without it.
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button type="button" className="th-btn th-btn-primary" disabled={busy || !hasName} onClick={() => void run()}>
              {busy ? 'Importing…' : `Import ${analysis.totalRows} row${analysis.totalRows === 1 ? '' : 's'}`}
            </button>
            <button type="button" className="th-btn" disabled={busy} onClick={() => { setAnalysis(null); setText(''); setRows(null); setFileName(''); }}>
              Choose a different file
            </button>
          </div>
        </>
      )}
    </div>
  );
}
