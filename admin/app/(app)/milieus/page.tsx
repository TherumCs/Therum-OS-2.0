import { apiGet } from '../../../lib/api';
import { MilieusClient, type MilieuRow } from './MilieusClient';

export const dynamic = 'force-dynamic';

// Milieus — named customer groups (the 2.0 native "memberships" engine).
// Reachable via the Studio section once the Milieus Studio app is enabled
// (see admin/app/(app)/studio/page.tsx + lib/nav.ts's studioApps injection).
export default async function MilieusPage() {
  // A backend failure must not masquerade as "no milieus yet" (audit B6) —
  // surface it as an error banner instead of an inviting empty state.
  let milieus: MilieuRow[] = [];
  let loadError = false;
  try {
    milieus = await apiGet<MilieuRow[]>('/api/milieus');
  } catch {
    loadError = true;
  }

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>Milieus</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Named member groups — bundle customers into milieus with their own discount, expiry, and member list.
      </p>
      <MilieusClient initial={milieus} loadError={loadError} />
    </div>
  );
}
