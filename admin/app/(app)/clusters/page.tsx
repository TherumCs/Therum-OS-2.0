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

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>Cluster</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Merge products from multiple sources into one customer-facing product — every color/size combo routed to the source that owns it.
      </p>
      <ClustersClient initial={clusters} loadError={loadError} />
    </div>
  );
}
