'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../lib/session';

// A Route Handler + client fetch, not the pre-existing createContent Server
// Action — reproduced live, during this build, the exact "Server Action id
// goes stale after a dev-server change" failure this project's own
// CHANGELOG already diagnosed for Settings/Dashboard (same fix applied
// there for the same reason: plain HTTP routes don't have this problem).
export function NewContentButton({ type, label }: { type: 'page' | 'post' | 'case_study'; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    setBusy(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/content`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: `Untitled ${label}`, type }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (e) {
      window.alert(`Couldn't create: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="th-btn th-btn-primary" onClick={handleCreate} disabled={busy}>
      + New {label}
    </button>
  );
}
