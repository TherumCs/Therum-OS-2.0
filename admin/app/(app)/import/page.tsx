'use client';
import { useMemo, useState } from 'react';

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const split = (l: string): string[] => l.split(',').map((s) => s.trim());
  const headers = lines.length ? split(lines[0] ?? '') : [];
  const rows = lines.slice(1).map(split);
  return { headers, rows };
}

export default function ImportPage() {
  const [raw, setRaw] = useState('name,price,sku\nStarter Hoodie,49.00,HOOD-1\nCanvas Tote,19.00,TOTE-1');
  const { headers, rows } = useMemo(() => parseCsv(raw), [raw]);
  return (
    <section>
      <h1>Import</h1>
      <p className="muted">Detect &amp; preview a CSV source. Mapping + background run (Bull worker) is wired in the backend importer.</p>
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={6}
        style={{ width: '100%', fontFamily: 'monospace', fontSize: 13, padding: 'var(--th-space-10)', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 'var(--th-space-14)' }}
      />
      <h3 style={{ fontSize: 14, margin: '0 0 var(--th-space-10)' }}>
        Detected {headers.length} columns · {rows.length} rows (showing 5)
      </h3>
      {headers.length > 0 && (
        <table>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 5).map((r, i) => (
              <tr key={i}>
                {headers.map((_, j) => (
                  <td key={j}>{r[j] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
