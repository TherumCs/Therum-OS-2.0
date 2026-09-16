'use client';

import { useMemo, useState } from 'react';
import { SubscribersTab } from './SubscribersTab';
import { ListsTab } from './ListsTab';
import { CampaignsTab, type CampaignRow } from './CampaignsTab';
import { SegmentsTab, type SegmentRow } from './SegmentsTab';
import { AutomationsTab, type AutomationRow } from './AutomationsTab';
import { FormsTab, type FormsData } from './FormsTab';
import { SettingsTab, type MarketingSettingsRow } from './SettingsTab';
import { CalendarTab } from './CalendarTab';

export interface StatsRow {
  total: number;
  subscribed: number;
  unsubscribed: number;
  pending: number;
  sms: number;
  lists: number;
  last30: number;
  bySource: { source: string; count: number }[];
}
export interface ListRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  members: number;
  createdAt: string;
}
export interface SubscriberRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  status: string;
  smsStatus: string;
  source: string;
  tags: string[];
  customerId: string | null;
  listIds: string[];
  subscribedAt: string;
  unsubscribedAt: string | null;
  createdAt: string;
}

export async function jsonOrThrow(res: Response): Promise<unknown> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) throw new Error((body as { error?: { message?: string } })?.error?.message || `Request failed (${res.status})`);
  return body;
}

export const api = {
  get: (path: string) => fetch(`/tos-admin/api/marketing/${path}`).then(jsonOrThrow),
  send: (method: string, path: string, body?: unknown) =>
    fetch(`/tos-admin/api/marketing/${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(jsonOrThrow),
};

type Tab = 'subscribers' | 'lists' | 'segments' | 'campaigns' | 'automations' | 'forms' | 'calendar' | 'settings';

// Tabs, like Promotions: a merchant is either looking at WHO (subscribers,
// lists) or at WHAT went out (campaigns, automations) — rarely both at once.
// Campaigns / Automations / Forms tabs land as their backends do.
export function MarketingClient({
  stats,
  initialSubscribers,
  initialCursor,
  lists: initialLists,
  campaigns,
  segments,
  automations,
  forms,
  settings,
  initialTab,
  loadError,
}: {
  stats: StatsRow | null;
  initialSubscribers: SubscriberRow[];
  initialCursor: string | null;
  lists: ListRow[];
  campaigns: CampaignRow[];
  segments: SegmentRow[];
  automations: AutomationRow[];
  forms: FormsData;
  settings: MarketingSettingsRow | null;
  initialTab?: string;
  loadError: boolean;
}) {
  const TAB_IDS: Tab[] = ['subscribers', 'lists', 'segments', 'campaigns', 'automations', 'forms', 'calendar', 'settings'];
  const [tab, setTabState] = useState<Tab>(TAB_IDS.includes(initialTab as Tab) ? (initialTab as Tab) : 'subscribers');
  // Keep the URL in step so the Flow sidebar item and a refresh both land on this tab.
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('tab', t);
      window.history.replaceState(null, '', u.toString());
    } catch {
      /* URL is a convenience, not a requirement */
    }
  };
  const [lists, setLists] = useState<ListRow[]>(initialLists);

  const TABS = useMemo(
    () => [
      { id: 'subscribers' as Tab, label: 'Subscribers', count: stats?.total ?? initialSubscribers.length },
      { id: 'lists' as Tab, label: 'Lists', count: lists.length },
      { id: 'segments' as Tab, label: 'Segments', count: segments.length },
      { id: 'campaigns' as Tab, label: 'Campaigns', count: campaigns.length },
      { id: 'automations' as Tab, label: 'Automations', count: automations.filter((a) => a.enabled).length },
      { id: 'forms' as Tab, label: 'Forms', count: forms.forms.filter((f) => f.enabled).length },
      { id: 'calendar' as Tab, label: 'Calendar', count: 0 },
      { id: 'settings' as Tab, label: 'Settings', count: 0 },
    ],
    [stats, initialSubscribers.length, lists.length, campaigns.length, segments.length, automations, forms],
  );

  if (loadError) return <div className="notice">Couldn&apos;t load marketing data — the backend may be offline.</div>;

  return (
    <div style={{ display: 'grid', gap: 'var(--th-space-16)' }}>
      <div className="th-tabs" role="tablist" aria-label="Flow">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={'th-tab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>
            {t.label}
            {t.count > 0 && <span className="th-tab__count">{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === 'subscribers' && <SubscribersTab initial={initialSubscribers} initialCursor={initialCursor} lists={lists} stats={stats} />}
      {tab === 'lists' && <ListsTab lists={lists} onChange={setLists} />}
      {tab === 'segments' && <SegmentsTab initial={segments} lists={lists} />}
      {tab === 'campaigns' && <CampaignsTab initial={campaigns} />}
      {tab === 'automations' && <AutomationsTab initial={automations} />}
      {tab === 'forms' && <FormsTab initial={forms} lists={lists} />}
      {tab === 'calendar' && <CalendarTab campaigns={campaigns} nextSlot={settings?.nextSlot ?? null} />}
      {tab === 'settings' && <SettingsTab initial={settings} />}
    </div>
  );
}
