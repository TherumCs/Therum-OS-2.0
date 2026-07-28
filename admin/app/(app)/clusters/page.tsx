import { apiGet } from '../../../lib/api';
import { ClustersClient, type ClusterRow } from './ClustersClient';

export const dynamic = 'force-dynamic';

export default async function ClustersPage() {
  // A backend failure must not masquerade as "no groups yet" — surface it.
  let clusters: ClusterRow[] = [];
  let loadError = false;
  try {
    clusters = await apiGet<ClusterRow[]>('/api/clusters');
  } catch {
    loadError = true;
  }

  const drifting = clusters.filter((c) => c.hasDrift).length;
  const members = clusters.reduce((sum, c) => sum + c.memberCount, 0);

  return (
    <section>
      <div className="th-lp-header">
        <div className="th-lp-header-left">
          <div className="th-lp-meta">
            <span className="th-lp-meta-dot" />
            {clusters.length} {clusters.length === 1 ? 'CLUSTER' : 'CLUSTERS'} · {members} LINKED · {drifting} DRIFTING
          </div>
          <h1 className="th-lp-title">Cluster</h1>
          <p className="th-lp-sub">
            Sell one product that lives in several places at once. Merge listings from multiple sources into a
            single customer-facing product, and every colour and size routes to whichever source actually owns
            that variant — so stock and price stay true to their origin.
          </p>
        </div>
      </div>

      <ClustersClient initial={clusters} loadError={loadError} />
    </section>
  );
}
