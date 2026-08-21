'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../lib/session';

export function RoleAssignSelect({ userId, initialRoleId, roles }: { userId: string; initialRoleId: string | null; roles: { id: string; name: string }[] }) {
  const router = useRouter();
  const [value, setValue] = useState(initialRoleId ?? '');
  const [busy, setBusy] = useState(false);

  async function change(next: string): Promise<void> {
    setValue(next);
    setBusy(true);
    try {
      await fetch(`${BASE_PATH}/api/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roleId: next || null }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      value={value}
      disabled={busy}
      onChange={(e) => void change(e.target.value)}
      style={{ padding: 'var(--th-space-6) var(--th-space-8)', border: '1px solid var(--th-line)', borderRadius: 'var(--th-r)', fontSize: 'var(--th-fs-xs)' }}
    >
      <option value="">Full administrator</option>
      {roles.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  );
}
