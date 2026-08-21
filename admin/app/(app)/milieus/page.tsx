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

  const members = milieus.reduce((sum, m) => sum + m.memberCount, 0);
  const open = milieus.filter((m) => m.regEnabled).length;

  return (
    <section>
      <div className="th-lp-header">
        <div className="th-lp-header-left">
          <div className="th-lp-meta">
            <span className="th-lp-meta-dot" />
            {milieus.length} {milieus.length === 1 ? 'MILIEU' : 'MILIEUS'} · {members} MEMBERS · {open} OPEN TO SIGNUP
          </div>
          <h1 className="th-lp-title">Milieus</h1>
          <p className="th-lp-sub">
            Named groups of customers — wholesale, friends and family, a members club. Each milieu carries its
            own discount, its own expiry, and its own member list, and can open a public signup page that
            people join themselves.
          </p>
        </div>
      </div>

      <MilieusClient initial={milieus} loadError={loadError} />
    </section>
  );
}
