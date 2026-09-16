'use client';
import { useState } from 'react';

// A read-only URL with a Copy button. The feed URL is the whole point of this
// page — a merchant pastes it into Commerce Manager / Merchant Center — so it
// has to be one click to grab, not a triple-click-and-pray selection.
export function CopyField({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the field is still selectable by hand */
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        style={{
          flex: '1 1 320px', minWidth: 0, fontFamily: 'var(--th-mono, ui-monospace, monospace)',
          fontSize: 12, padding: '8px 10px', border: '1px solid var(--th-line)',
          borderRadius: 8, background: 'var(--th-surface-2, var(--th-surface))', color: 'var(--th-text)',
        }}
      />
      <button type="button" className="th-btn th-btn--sm" onClick={() => void copy()}>
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
      <a className="th-btn th-btn--sm" href={url} target="_blank" rel="noreferrer">Open ↗</a>
    </div>
  );
}
