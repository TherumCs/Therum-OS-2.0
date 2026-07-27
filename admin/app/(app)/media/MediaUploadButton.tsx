'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../lib/session';

export function MediaUploadButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null): Promise<void> {
    if (!files || !files.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`${BASE_PATH}/api/media/upload`, { method: 'POST', body: form });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message ?? `Upload failed (${res.status})`);
        }
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" multiple hidden onChange={(e) => void handleFiles(e.target.files)} />
      <button type="button" className="th-btn th-btn-primary" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Uploading…' : 'Upload'}
      </button>
      {error && (
        <span className="notice" style={{ marginLeft: 'var(--th-space-8)', padding: 'var(--th-space-4) var(--th-space-10)', fontSize: 12 }}>
          {error}
        </span>
      )}
    </>
  );
}
