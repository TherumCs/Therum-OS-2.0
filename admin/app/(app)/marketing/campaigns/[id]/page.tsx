import { apiGet } from '../../../../../lib/api';
import { BASE_PATH } from '../../../../../lib/session';
import { CampaignEditor, type CampaignFull } from './CampaignEditor';

export const dynamic = 'force-dynamic';

// One campaign: the composer. Blocks on the left, the real rendered email on
// the right, the HTML of any block a click away.
export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let campaign: CampaignFull | null = null;
  let err: string | null = null;
  try {
    campaign = await apiGet<CampaignFull>(`/api/marketing/campaigns/${id}`);
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  if (!campaign) {
    return (
      <section>
        <a href={`${BASE_PATH}/marketing`} className="th-hint">← Marketing</a>
        <div className="notice" style={{ marginTop: 12 }}>Could not load that campaign{err ? ` (${err})` : ''}.</div>
      </section>
    );
  }
  return <CampaignEditor initial={campaign} />;
}
