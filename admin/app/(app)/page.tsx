import type { ReactNode } from 'react';
import { apiGet } from '../../lib/api';
import { CardResizeHandle } from './CardResizeHandle';
import { StudioAgentCard } from './StudioAgentCard';
import { DASHBOARD_PRESETS, activePreset, type PresetKey } from './dashboardPresets';
import { timeAgo } from '../../lib/types';
import type { Paged, Product, Order, Extension } from '../../lib/types';
import { BASE_PATH } from '../../lib/session';

export const dynamic = 'force-dynamic';

interface ContentItem {
  id: string;
  type: string;
  title: string;
  status: string;
  updatedAt: string;
}
interface CapabilitySummary {
  id: string;
  active: string | null;
}
interface MeResponse {
  username: string;
  dashboardLayout: DashboardCard[];
}
interface AdminUserRow {
  id: string;
}
interface HealthCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error';
  detail: string;
}
interface HealthResponse {
  status: 'ok' | 'warn' | 'error';
  checks: HealthCheck[];
}
interface DashboardCard {
  id: string;
  size: 'xs' | 'sm' | 'md' | 'lg';
}
interface Onboarding {
  completed: boolean;
}
interface ConnectionSummary {
  id: string;
  name: string;
  category: string;
  connected: boolean;
  lastTestOk: boolean | null;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

// 3/6/9/12 of a 12-column grid (25/50/75/100%) — matches 1.9.44's real
// .th-card[data-size] spans exactly (therum-shell.css), not an arbitrary scale.
const SIZE_SPAN: Record<DashboardCard['size'], number> = { xs: 3, sm: 6, md: 9, lg: 12 };

// Card chrome: title, move up/down, size picker — plain forms posting to
// Route Handlers (admin/app/api/dashboard-layout/*), not Server Actions.
// Server Action ids are a content hash baked into the page bundle at compile
// time; this dev server gets restarted often during active work, and an
// already-loaded page's action reference goes stale the moment that happens
// ("Invalid Server Actions request" — hit live testing this exact feature).
// The current layout travels as a hidden JSON field since a Route Handler
// can't close over component state the way a bound Server Action can.
function CardShell({
  id,
  title,
  size,
  layout,
  viewAllHref,
  viewAllLabel = 'View all →',
  children,
}: {
  id: string;
  title: string;
  size: DashboardCard['size'];
  layout: DashboardCard[];
  viewAllHref?: string;
  viewAllLabel?: string;
  children: ReactNode;
}) {
  const i = layout.findIndex((c) => c.id === id);
  const layoutJson = JSON.stringify(layout);
  return (
    <div className="th-card dash-card" data-size={size} style={{ gridColumn: `span ${SIZE_SPAN[size]}` }}>
      <div className="th-card-head">
        <span className="th-card-label">{title}</span>
        {viewAllHref && (
          <a href={`${BASE_PATH}${viewAllHref}`} className="th-card-link">
            {viewAllLabel}
          </a>
        )}
        <div className="dash-card-controls">
          <form action={`${BASE_PATH}/api/dashboard-layout/move`} method="post" style={{ display: 'inline' }}>
            <input type="hidden" name="layout" value={layoutJson} />
            <input type="hidden" name="cardId" value={id} />
            <input type="hidden" name="direction" value="up" />
            <button type="submit" className="chip" disabled={i <= 0} title="Move up">
              ↑
            </button>
          </form>
          <form action={`${BASE_PATH}/api/dashboard-layout/move`} method="post" style={{ display: 'inline' }}>
            <input type="hidden" name="layout" value={layoutJson} />
            <input type="hidden" name="cardId" value={id} />
            <input type="hidden" name="direction" value="down" />
            <button type="submit" className="chip" disabled={i < 0 || i >= layout.length - 1} title="Move down">
              ↓
            </button>
          </form>
        </div>
      </div>
      {children}
      <CardResizeHandle basePath={BASE_PATH} cardId={id} layoutJson={layoutJson} current={size} />
    </div>
  );
}

function StatusDot({ status }: { status: HealthCheck['status'] }) {
  const color = status === 'ok' ? 'var(--th-success-text)' : status === 'warn' ? 'var(--th-warning-text)' : 'var(--th-danger-text)';
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: color, marginRight: 6 }} />;
}

const GREET_FORMAT = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const TIME_FORMAT = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

export default async function Home() {
  const [content, prods, orders, exts, users, caps, me, health, onboarding, connections] = await Promise.all([
    safe(apiGet<Paged<ContentItem>>('/api/content?limit=100')),
    safe(apiGet<Paged<Product>>('/api/products?limit=100')),
    safe(apiGet<Paged<Order>>('/api/orders?limit=100')),
    safe(apiGet<Extension[]>('/api/extensions')),
    safe(apiGet<AdminUserRow[]>('/api/users')),
    safe(apiGet<CapabilitySummary[]>('/api/capabilities')),
    safe(apiGet<MeResponse>('/api/me')),
    safe(apiGet<HealthResponse>('/api/system/health')),
    safe(apiGet<Onboarding>('/api/settings/onboarding')),
    safe(apiGet<ConnectionSummary[]>('/api/connections')),
  ]);
  const down = !content && !prods && !orders && !exts;
  const commerceActive = Boolean(caps?.find((c) => c.id === 'commerce')?.active);
  const layout = (me?.dashboardLayout ?? [
    { id: 'pages', size: 'xs' },
    { id: 'posts', size: 'xs' },
    { id: 'products', size: 'xs' },
    { id: 'users', size: 'xs' },
    { id: 'studio-agent', size: 'md' },
    { id: 'recent-activity', size: 'md' },
    { id: 'site-health', size: 'xs' },
  ]).filter((c) => (c.id === 'products' ? commerceActive : true));

  const current = activePreset(layout);

  const pages = content?.items.filter((c) => c.type === 'page') ?? [];
  const posts = content?.items.filter((c) => c.type === 'post') ?? [];
  const byStatus = (items: ContentItem[]) => {
    const out = { published: 0, draft: 0, archived: 0 } as Record<string, number>;
    items.forEach((c) => (out[c.status] = (out[c.status] ?? 0) + 1));
    return out;
  };
  const pagesByStatus = byStatus(pages);
  const postsByStatus = byStatus(posts);
  const recentOf = (items: ContentItem[]) => [...items].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, 4);
  const recent = [...(content?.items ?? [])].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, 5);

  const now = new Date();
  const firstName = me?.username ?? 'there';

  return (
    <section className="th-dash">
      <div className="th-dash-greet muted">
        {GREET_FORMAT.format(now)} · {TIME_FORMAT.format(now)}
      </div>
      <h1 className="th-dash-title">Welcome back, {firstName}</h1>
      <p className="th-dash-sub">Here&apos;s what&apos;s happening with Therum CMS today.</p>

      {onboarding && !onboarding.completed && (
        <div className="notice row-between" style={{ background: 'var(--th-accent-tint)', color: 'var(--th-accent)' }}>
          <span>Finish setting up your site — edition, connections, and branding.</span>
          <a href={`${BASE_PATH}/onboarding`} className="th-btn th-btn-primary">
            Continue setup →
          </a>
        </div>
      )}

      <input type="checkbox" id="th-edit-toggle" style={{ display: 'none' }} />
      <div className="th-dash-actions">
        <a href={`${BASE_PATH}/pages`} className="th-btn th-btn-primary">
          + New Page
        </a>
        <a href={`${BASE_PATH}/posts`} className="th-btn">
          + New Post
        </a>
        <a href={`${BASE_PATH}/media`} className="th-btn">
          Upload Media
        </a>
        <div className="th-dash-actions-spacer" />
        <label htmlFor="th-edit-toggle" className="th-btn" style={{ cursor: 'pointer' }}>
          Edit layout
        </label>
      </div>

      <div className="th-edit-bar">
        <div className="th-edit-bar-text">
          <strong>Edit layout</strong>{' · '}arrows reorder, drag a card&apos;s bottom-right corner to resize.
        </div>
        <div className="th-edit-bar-actions">
          <form action={`${BASE_PATH}/api/dashboard-layout/reset`} method="post" style={{ display: 'inline' }}>
            <button type="submit" className="th-btn" title="Reset card order and sizes back to default">
              Reset
            </button>
          </form>
          <label htmlFor="th-edit-toggle" className="th-btn th-btn-primary" style={{ cursor: 'pointer' }}>
            Done
          </label>
        </div>
        <div className="th-dash-presets">
          <span className="th-dash-presets-label">View</span>
          {(Object.entries(DASHBOARD_PRESETS) as [PresetKey, { label: string; hint: string }][]).map(([key, p]) => (
            <form key={key} action={`${BASE_PATH}/api/dashboard-layout/preset`} method="post" style={{ display: 'inline' }}>
              <input type="hidden" name="layout" value={JSON.stringify(layout)} />
              <input type="hidden" name="preset" value={key} />
              <button
                type="submit"
                className={'th-dash-preset' + (current === key ? ' active' : '')}
                title={p.hint}
                aria-pressed={current === key}
              >
                {p.label}
              </button>
            </form>
          ))}
        </div>
      </div>

      {down && <div className="notice">API offline — start the backend on :4100 (`npm start` in therum-cms-2).</div>}
      <div className="th-bento">
        {layout.map((c) => {
          if (c.id === 'pages') {
            return (
              <CardShell key={c.id} id="pages" title="Pages" size={c.size} layout={layout} viewAllHref="/pages">
                <div className="th-stat-val">{pages.length}</div>
                <div className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>Total pages</div>
                {c.size !== 'xs' && (
                  <div className="dash-breakdown">
                    <span className="pill pill-ok">{pagesByStatus.published ?? 0} published</span>
                    <span className="pill pill-pending">{pagesByStatus.draft ?? 0} draft</span>
                  </div>
                )}
                {c.size === 'lg' && (
                  <ul className="dash-list">
                    {recentOf(pages).map((r) => (
                      <li key={r.id}>
                        <span>{r.title}</span> <span className="muted">{timeAgo(r.updatedAt)}</span>
                      </li>
                    ))}
                    {!pages.length && <li className="muted">No pages yet.</li>}
                  </ul>
                )}
              </CardShell>
            );
          }
          if (c.id === 'posts') {
            return (
              <CardShell key={c.id} id="posts" title="Posts" size={c.size} layout={layout} viewAllHref="/posts">
                <div className="th-stat-val">{posts.length}</div>
                <div className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>Published posts</div>
                {c.size !== 'xs' && (
                  <div className="dash-breakdown">
                    <span className="pill pill-ok">{postsByStatus.published ?? 0} published</span>
                    <span className="pill pill-pending">{postsByStatus.draft ?? 0} draft</span>
                  </div>
                )}
                {c.size === 'lg' && (
                  <ul className="dash-list">
                    {recentOf(posts).map((r) => (
                      <li key={r.id}>
                        <span>{r.title}</span> <span className="muted">{timeAgo(r.updatedAt)}</span>
                      </li>
                    ))}
                    {!posts.length && <li className="muted">No posts yet.</li>}
                  </ul>
                )}
              </CardShell>
            );
          }
          if (c.id === 'products' && commerceActive) {
            return (
              <CardShell key={c.id} id="products" title="Products" size={c.size} layout={layout}>
                <div className="th-stat-val">{prods?.items.length ?? '—'}</div>
                {c.size !== 'xs' && (
                  <div className="dash-breakdown">
                    <span className="pill pill-ok">{prods?.items.filter((p) => p.status === 'active').length ?? 0} active</span>
                    <span className="pill pill-pending">{prods?.items.filter((p) => p.status === 'draft').length ?? 0} draft</span>
                  </div>
                )}
              </CardShell>
            );
          }
          if (c.id === 'users') {
            return (
              <CardShell key={c.id} id="users" title="Users" size={c.size} layout={layout} viewAllHref="/users">
                <div className="th-stat-val">{users?.length ?? '—'}</div>
                <div className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>Registered users</div>
              </CardShell>
            );
          }
          if (c.id === 'studio-agent') {
            return (
              <CardShell key={c.id} id="studio-agent" title="Studio assistant" size={c.size} layout={layout}>
                <StudioAgentCard />
              </CardShell>
            );
          }
          if (c.id === 'recent-activity') {
            return (
              <CardShell key={c.id} id="recent-activity" title="Recent activity" size={c.size} layout={layout}>
                <ul className="dash-list">
                  {recent.map((r) => (
                    <li key={r.id}>
                      <span>{r.title}</span> <span className="muted">{timeAgo(r.updatedAt)}</span>
                    </li>
                  ))}
                  {!recent.length && <li className="muted">Nothing published or edited yet.</li>}
                </ul>
              </CardShell>
            );
          }
          if (c.id === 'site-health') {
            const bad = health?.checks.filter((h) => h.status !== 'ok') ?? [];
            return (
              <CardShell key={c.id} id="site-health" title="Site health" size={c.size} layout={layout} viewAllHref="/settings/security" viewAllLabel="Details →">
                <div className="th-stat-val" style={{ fontSize: 18 }}>
                  <StatusDot status={health?.status ?? 'error'} />
                  {health?.status === 'ok' ? 'All good' : 'Action needed'}
                </div>
                <div className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>
                  {bad.length ? `${bad.length} issue${bad.length === 1 ? '' : 's'}` : 'Everything checked out clean'}
                </div>
                {c.size !== 'xs' && (
                  <ul className="dash-list">
                    {(c.size === 'lg' ? health?.checks : bad)?.map((h) => (
                      <li key={h.id}>
                        <StatusDot status={h.status} />
                        <span>{h.label}</span> — <span className="muted">{h.detail}</span>
                      </li>
                    ))}
                    {!bad.length && c.size !== 'lg' && <li className="muted">Everything checked out clean.</li>}
                  </ul>
                )}
              </CardShell>
            );
          }
          return null;
        })}

        {/* Connections status card — sticky per the 1.x preview spec:
            "always shown when any connector is active". Reads real Nexus
            state; groups health rows; needs-attention first. */}
        {(connections?.some((c) => c.connected) ?? false) && (() => {
          const active = (connections ?? []).filter((c) => c.connected);
          const failing = active.filter((c) => c.lastTestOk === false);
          return (
            <div className="th-card dash-card" data-size="sm" style={{ gridColumn: 'span 6' }}>
              <div className="th-card-head">
                <span className="th-card-label">Connections</span>
                <a href={`${BASE_PATH}/settings/connections`} className="th-card-link">Manage →</a>
              </div>
              <div className="th-stat-val" style={{ fontSize: 18 }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: failing.length ? 'var(--th-warning-text)' : 'var(--th-success-text)', marginRight: 6 }} />
                {active.length} connected{failing.length ? ` · ${failing.length} needs attention` : ''}
              </div>
              <ul className="dash-list">
                {[...failing, ...active.filter((c) => c.lastTestOk !== false)].slice(0, 5).map((c) => (
                  <li key={c.id}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: c.lastTestOk === false ? 'var(--th-danger-text)' : 'var(--th-success-text)', marginRight: 6 }} />
                    <span>{c.name}</span> <span className="muted">{c.category}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}

        {/* Claude / MCP card — the AI surface rides MCP, not a rebuilt chat:
            connect Claude (Code or claude.ai) to this site's MCP endpoint and
            it can list content, draft posts, read sales, check connections. */}
        <div className="th-card dash-card" data-size="sm" style={{ gridColumn: 'span 6' }}>
          <div className="th-card-head">
            <span className="th-card-label">Claude · MCP</span>
            <a href={`${BASE_PATH}/account`} className="th-card-link">API tokens →</a>
          </div>
          <div className="th-stat-val" style={{ fontSize: 18 }}>7 tools</div>
          <div className="muted" style={{ fontSize: 'var(--th-fs-2xs)', marginBottom: 6 }}>
            Connect Claude to run this site — drafts, sales reports, connection health.
          </div>
          <code style={{ display: 'block', fontSize: 11, background: 'var(--th-surface-2, rgba(0,0,0,.04))', border: '1px solid var(--th-line)', borderRadius: 8, padding: '6px 8px', overflowX: 'auto' }}>
            {'{api-host}'}/api/mcp · Bearer tro_…
          </code>
          <div className="muted" style={{ fontSize: 'var(--th-fs-2xs)', marginTop: 6 }}>
            Read tokens can look; write scope unlocks create_draft. Publishing stays human.
          </div>
        </div>
      </div>
    </section>
  );
}
