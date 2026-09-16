import { apiGet } from '../../../lib/api';
import { MarketingClient, type ListRow, type StatsRow, type SubscriberRow } from './MarketingClient';
import type { CampaignRow } from './CampaignsTab';
import type { SegmentRow } from './SegmentsTab';
import type { AutomationRow } from './AutomationsTab';
import type { FormsData } from './FormsTab';
import type { MarketingSettingsRow } from './SettingsTab';

export const dynamic = 'force-dynamic';

// Counter › Marketing (Flow) — who consented to hear from the store, in which
// lists, and everything that gets sent to them. Email and SMS.
//
// This is the section Promotions deliberately declined to be: it earns the
// name because every tab here has a real backend behind it.
export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  let stats: StatsRow | null = null;
  let subscribers: SubscriberRow[] = [];
  let lists: ListRow[] = [];
  let campaigns: CampaignRow[] = [];
  let segments: SegmentRow[] = [];
  let automations: AutomationRow[] = [];
  let forms: FormsData = { forms: [], footer: { submits: 0 } };
  let settings: MarketingSettingsRow | null = null;
  let nextCursor: string | null = null;
  let loadError = false;
  try {
    const [s, subs, l, c, seg, auto, fm, st] = await Promise.all([
      apiGet<StatsRow>('/api/marketing/stats'),
      apiGet<{ items: SubscriberRow[]; nextCursor: string | null }>('/api/marketing/subscribers?limit=200'),
      apiGet<ListRow[]>('/api/marketing/lists'),
      apiGet<CampaignRow[]>('/api/marketing/campaigns'),
      apiGet<SegmentRow[]>('/api/marketing/segments').catch((): SegmentRow[] => []),
      apiGet<AutomationRow[]>('/api/marketing/automations').catch((): AutomationRow[] => []),
      apiGet<FormsData>('/api/marketing/forms').catch((): FormsData => ({ forms: [], footer: { submits: 0 } })),
      apiGet<MarketingSettingsRow>('/api/marketing/settings').catch((): MarketingSettingsRow | null => null),
    ]);
    automations = auto;
    forms = fm;
    settings = st;
    campaigns = c;
    segments = seg;
    stats = s;
    subscribers = subs.items;
    nextCursor = subs.nextCursor;
    lists = l;
  } catch {
    loadError = true;
  }

  return (
    <section>
      <div className="th-lp-header">
        <div className="th-lp-header-left">
          <div className="th-lp-meta">
            <span className="th-lp-meta-dot" />
            {stats ? `${stats.subscribed} SUBSCRIBED · ${stats.unsubscribed} OPTED OUT · ${stats.last30} NEW IN 30 DAYS · ${stats.lists} LISTS` : 'MARKETING'}
          </div>
          <h1 className="th-lp-title">Flow</h1>
          <p className="th-lp-sub">
            Email and SMS. Subscribers are people who said yes to hearing from you; lists and segments group them;
            campaigns and automations reach them. Opt-outs are honoured everywhere the moment they happen.
          </p>
        </div>
      </div>

      <MarketingClient stats={stats} initialSubscribers={subscribers} initialCursor={nextCursor} lists={lists} campaigns={campaigns} segments={segments} automations={automations} forms={forms} settings={settings} initialTab={tab} loadError={loadError} />
    </section>
  );
}
