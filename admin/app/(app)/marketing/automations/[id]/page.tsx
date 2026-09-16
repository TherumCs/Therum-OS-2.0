import { apiGet } from '../../../../../lib/api';
import { BASE_PATH } from '../../../../../lib/session';
import { CampaignEditor, type CampaignFull } from '../../campaigns/[id]/CampaignEditor';

export const dynamic = 'force-dynamic';

// One automation: the same composer as a campaign, with the trigger where the
// audience would be.
export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let automation: CampaignFull | null = null;
  let err: string | null = null;
  try {
    automation = await apiGet<CampaignFull>(`/api/marketing/automations/${id}`);
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  if (!automation) {
    return (
      <section>
        <a href={`${BASE_PATH}/marketing`} className="th-hint">← Marketing</a>
        <div className="notice" style={{ marginTop: 12 }}>Could not load that automation{err ? ` (${err})` : ''}.</div>
      </section>
    );
  }
  return <CampaignEditor initial={automation} kind="automation" />;
}
