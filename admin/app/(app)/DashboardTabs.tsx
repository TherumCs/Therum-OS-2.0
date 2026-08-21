'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../lib/session';

/* ─────────────────────────── types ─────────────────────────── */
interface StatusBlock { total: number; published: number; draft: number; recent: { title: string; updatedAt: string; status: string; type: string }[] }
export interface DashData {
  storeName: string;
  commerceActive: boolean;
  pages: StatusBlock;
  posts: StatusBlock;
  contentTotal: number;
  mediaCount: number;
  products: { total: number; active: number; variants: number };
  topProducts: { name: string; cents: number }[];
  customers: number;
  orders: {
    total: number; byStatus: Record<string, number>; last30d: number; revenueCents: number; aovCents: number;
    series: { label: string; cents: number }[];
    recent: { who: string; number: string; total: number; status: string; items: { name: string; qty: number; total: number }[] }[];
  };
  activity: { attempted: number; abandoned: { count: number; valueCents: number }; launchList: number; sources: { source: string; orders: number }[] };
  health: { status: 'ok' | 'warn' | 'error'; checks: { label: string; status: 'ok' | 'warn' | 'error'; detail: string }[] };
}
interface Ctx { studioAgent: ReactNode; refresh: () => void; refreshedLabel: string }
type Size = 'xs' | 'sm' | 'md' | 'lg';
interface W { id: string; size: Size }

/* ─────────────────────────── helpers ─────────────────────────── */
const usd = (c: number): string => '$' + Math.round(c / 100).toLocaleString('en-US');
const initials = (s: string): string => (s || '?').split(/\s+/).slice(0, 2).map((x) => x[0] || '').join('').toUpperCase();
const dotColor = (s: 'ok' | 'warn' | 'error'): string => (s === 'ok' ? '#22c55e' : s === 'warn' ? '#f59e0b' : '#ef4444');
const pillClass = (s: string): string => (['delivered', 'processing', 'shipped', 'published'].includes(s) ? 'ok' : ['pending', 'draft'].includes(s) ? 'pend' : 'can');
const timeAgo = (d: string): string => { const s = (Date.now() - +new Date(d)) / 1000; return s < 3600 ? Math.max(1, Math.round(s / 60)) + 'm' : s < 86400 ? Math.round(s / 3600) + 'h' : Math.round(s / 86400) + 'd'; };
const STATUS_META: [string, string][] = [['delivered', '#22c55e'], ['processing', '#3b82f6'], ['shipped', '#0ea5e9'], ['cancelled', '#94a3b8'], ['failed', '#ef4444'], ['pending', '#f59e0b']];

function Dot({ s }: { s: 'ok' | 'warn' | 'error' }) { return <span className="dsh-dot" style={{ background: dotColor(s) }} />; }

/* ─────────────────────────── interactive chart ─────────────────────────── */
function RevChart({ series }: { series: { label: string; cents: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const pts = series.length ? series : [{ label: '', cents: 0 }];
  const W = 600, H = 150;
  const vals = pts.map((p) => p.cents);
  const mn = Math.min(...vals), mx = Math.max(...vals), rg = (mx - mn) || 1;
  const xy = pts.map((p, i) => [pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * W, H - 14 - ((p.cents - mn) / rg) * (H - 34)] as const);
  const path = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current; if (!el) return;
    const b = el.getBoundingClientRect(); const x = ((e.clientX - b.left) / b.width) * W;
    setHover(Math.max(0, Math.min(xy.length - 1, Math.round((x / W) * (xy.length - 1)))));
  };
  const h = hover != null ? xy[hover] : null;
  return (
    <div className="dsh-chart">
      {h && <div className="dsh-tip" style={{ left: (h[0] / W) * 100 + '%', top: (h[1] / H) * 100 + '%' }}>{usd(pts[hover!].cents)}</div>}
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <g className="dsh-cgrid"><line x1="0" y1="38" x2={W} y2="38" /><line x1="0" y1="76" x2={W} y2="76" /><line x1="0" y1="114" x2={W} y2="114" /></g>
        <defs><linearGradient id="dshga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#16a34a" stopOpacity=".2" /><stop offset="1" stopColor="#16a34a" stopOpacity="0" /></linearGradient></defs>
        {pts.length > 1 && <path d={path + ` L${W},${H} L0,${H} Z`} fill="url(#dshga)" />}
        <path d={path} fill="none" stroke="#16a34a" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {h && <><line x1={h[0]} x2={h[0]} y1="0" y2={H} stroke="var(--th-line)" /><circle cx={h[0]} cy={h[1]} r={4.5} fill="#16a34a" stroke="var(--th-card-bg)" strokeWidth={2} /></>}
      </svg>
      <div className="dsh-xax">{pts.map((p, i) => <span key={i}>{p.label}</span>)}</div>
    </div>
  );
}

/* ─────────────────────────── shared bits ─────────────────────────── */
function CardHead({ title, tint, right }: { title: string; tint?: string; right?: ReactNode }) {
  return <div className="dsh-ch"><h3>{tint && <span className="dsh-hic" style={{ background: tint }} />}{title}</h3>{right && <div style={{ marginLeft: 'auto' }}>{right}</div>}</div>;
}
function StatGrid({ cells }: { cells: [string, string, string?][] }) {
  return <div className="dsh-statgrid">{cells.map(([l, v, s], i) => <div key={i}><div className="dsh-mlbl">{l}</div><div className="dsh-v">{v}</div>{s && <div className="dsh-ms">{s}</div>}</div>)}</div>;
}
function Bar({ label, w, color, val }: { label: string; w: number; color: string; val: string }) {
  return <div className="dsh-barrow"><span className="dsh-bn">{label}</span><div className="dsh-bar"><span style={{ width: Math.min(100, w) + '%', background: color }} /></div><span className="dsh-bv">{val}</span></div>;
}

/* ─────────────────────────── widgets ─────────────────────────── */
function WCommerce({ data }: { data: DashData }) {
  const [sub, setSub] = useState('rev');
  const [exp, setExp] = useState<number | null>(null);
  const d = data.orders;
  const rows = STATUS_META.map(([k, c]) => [k, d.byStatus[k] ?? 0, c] as const).filter((r) => r[1] > 0);
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="dsh-card">
      <CardHead title="Commerce" tint="var(--dt-green)" right={<div className="dsh-subs">{[['rev', 'Revenue'], ['ord', 'Orders'], ['prod', 'Products'], ['cart', 'Carts']].map(([k, l]) => <button key={k} className={'dsh-st' + (sub === k ? ' on' : '')} onClick={() => setSub(k)}>{l}</button>)}</div>} />
      <div className="dsh-cb">
        {sub === 'rev' && <>
          <div className="dsh-krow"><div className="dsh-kpi">{usd(d.revenueCents)}</div><div className="dsh-lbl" style={{ paddingBottom: 5 }}>paid · 30 days</div></div>
          <RevChart series={d.series} />
          <StatGrid cells={[['Orders', String(d.total), `${d.byStatus.delivered ?? 0} delivered`], ['Avg order', usd(d.aovCents)], ['Abandoned', String(data.activity.abandoned.count), usd(data.activity.abandoned.valueCents)], ['Refunds', '$0']]} />
        </>}
        {sub === 'ord' && <>
          {rows.map((r) => <Bar key={r[0]} label={r[0][0].toUpperCase() + r[0].slice(1)} w={(r[1] / max) * 100} color={r[2]} val={String(r[1])} />)}
          <div className="dsh-lbl" style={{ margin: '16px 0 2px' }}>Recent — click to expand</div>
          {d.recent.slice(0, 5).map((o, i) => <div key={i}>
            <div className="dsh-row exp" onClick={() => setExp(exp === i ? null : i)}><div className="dsh-pfp">{initials(o.who)}</div><div style={{ minWidth: 0 }}><div className="dsh-rn">{o.who}</div><div className="dsh-re">SMNY-…{o.number}</div></div><span className={'dsh-pill ' + pillClass(o.status)} style={{ marginLeft: 'auto' }}>{o.status}</span><div className="dsh-rt">{usd(o.total)}</div></div>
            <div className={'dsh-detail' + (exp === i ? ' open' : '')}>{o.items.length ? o.items.map((it, j) => <div className="dsh-di" key={j}><span>{it.qty}× {it.name}</span><span>{usd(it.total)}</span></div>) : <div className="dsh-di"><span>Migrated order — line items in record</span><span></span></div>}</div>
          </div>)}
          {!d.recent.length && <p className="dsh-empty">No orders yet.</p>}
        </>}
        {sub === 'prod' && <>
          <div className="dsh-lbl" style={{ marginBottom: 6 }}>Top sellers</div>
          {data.topProducts.length ? data.topProducts.map((p) => <Bar key={p.name} label={p.name} w={(p.cents / Math.max(1, data.topProducts[0].cents)) * 100} color="linear-gradient(90deg,#16a34a,#4ade80)" val={usd(p.cents)} />) : <p className="dsh-empty">No sales recorded yet.</p>}
          <StatGrid cells={[['Active', String(data.products.active)], ['Variants', data.products.variants.toLocaleString()], ['Total', String(data.products.total)], ['Catalog', 'live']]} />
        </>}
        {sub === 'cart' && <>
          <div className="dsh-krow"><div className="dsh-kpi sm">{data.activity.abandoned.count} carts</div><div className="dsh-lbl" style={{ paddingBottom: 4, color: 'var(--th-warning-text)' }}>{usd(data.activity.abandoned.valueCents)} recoverable</div></div>
          <p className="dsh-empty" style={{ marginTop: 10 }}>{data.activity.attempted} checkout(s) started and not finished. Recovery nudges are live.</p>
        </>}
      </div>
    </div>
  );
}

function WWebsite({ data, ctx }: { data: DashData; ctx: Ctx }) {
  const bad = data.health.checks.filter((c) => c.status !== 'ok');
  return (
    <div className="dsh-card">
      <CardHead title="Website status" tint="var(--dt-blue)" right={<span className={'dsh-pill ' + (data.health.status === 'ok' ? 'ok' : 'pend')}>{data.health.status === 'ok' ? 'All systems' : `${bad.length} to watch`}</span>} />
      <div className="dsh-cb">
        <div className="dsh-krow"><div className="dsh-kpi sm">{data.health.status === 'ok' ? '100%' : '—'}</div><div className="dsh-lbl">uptime · healthy</div></div>
        <div style={{ marginTop: 12 }}>
          {(data.health.checks.length ? data.health.checks : [{ label: 'Health', status: 'warn' as const, detail: 'unavailable' }]).slice(0, 6).map((c, i) => <div className="dsh-check" key={i}><Dot s={c.status} /><div style={{ minWidth: 0 }}><div className="dsh-ckt">{c.label}</div><div className="dsh-ckd">{c.detail}</div></div></div>)}
        </div>
        <div className="dsh-metrics"><div><div className="dsh-ms">Pages</div><div className="dsh-mv">{data.pages.total}</div></div><div><div className="dsh-ms">Journal</div><div className="dsh-mv">{data.posts.total}</div></div><div><div className="dsh-ms">Content</div><div className="dsh-mv">{data.contentTotal}</div></div><div><div className="dsh-ms">Refreshed</div><div className="dsh-mv" style={{ fontSize: 12 }}>{ctx.refreshedLabel}</div></div></div>
      </div>
    </div>
  );
}

function WAudience({ data }: { data: DashData }) {
  const tot = Math.max(1, data.activity.sources.reduce((s, x) => s + x.orders, 0));
  return (
    <div className="dsh-card">
      <CardHead title="Audience" tint="var(--dt-violet)" right={<a className="dsh-chip" href={`${BASE_PATH}/customers`}>Customers →</a>} />
      <div className="dsh-cb">
        <div className="dsh-grid2"><div className="dsh-tile t-violet"><div className="dsh-lbl">Customers</div><div className="dsh-kpi sm" style={{ marginTop: 6 }}>{data.customers}</div></div><div className="dsh-tile t-mint"><div className="dsh-lbl">Orders / cust</div><div className="dsh-kpi sm" style={{ marginTop: 6 }}>{data.customers ? (data.orders.total / data.customers).toFixed(1) : '0'}</div></div></div>
        <div className="dsh-lbl" style={{ margin: '15px 0 2px' }}>Top sources · orders</div>
        {data.activity.sources.length ? data.activity.sources.slice(0, 4).map((s, i) => <Bar key={s.source} label={s.source} w={(s.orders / tot) * 100} color={i === 0 ? '#22c55e' : 'linear-gradient(90deg,#f5389a,#ff8a3d)'} val={String(s.orders)} />) : <p className="dsh-empty">No attributed orders yet — sources fill as traffic arrives.</p>}
      </div>
    </div>
  );
}

function WActivity({ data, ctx }: { data: DashData; ctx: Ctx }) {
  const events = data.orders.recent.slice(0, 6).map((o) => ({ t: `Order — ${o.who}`, m: `${usd(o.total)} · ${o.status}`, c: pillClass(o.status) === 'ok' ? 'g' : 'p' }));
  return (
    <div className="dsh-card">
      <CardHead title="Recent activity" tint="var(--dt-amber)" right={<button className="dsh-chip act" onClick={ctx.refresh}>↻ Refresh</button>} />
      <div className="dsh-cb"><div className="dsh-feed">
        {events.length ? events.map((e, i) => <div className={'dsh-fe ' + e.c} key={i}><div className="dsh-ft">{e.t}</div><div className="dsh-fm">{e.m}</div></div>) : <p className="dsh-empty">Nothing recent.</p>}
      </div><p className="dsh-empty" style={{ marginTop: 10, fontSize: 11 }}>Updated {ctx.refreshedLabel} · manual pull</p></div>
    </div>
  );
}

// The widget Bam asked for by name: at a glance, who bought (came through), who
// tried and did not finish (attempted), and who is sitting on a live cart right
// now (abandoned). The three headline tiles are the answer; the sub-tabs let you
// walk each list. All numbers are real — see dashboard.service.activity().
function WPurchases({ data, ctx }: { data: DashData; ctx: Ctx }) {
  const [sub, setSub] = useState('fun');
  const [exp, setExp] = useState<number | null>(null);
  const bs = data.orders.byStatus;
  const paid = (bs.processing ?? 0) + (bs.shipped ?? 0) + (bs.delivered ?? 0);
  const pending = bs.pending ?? 0, failed = bs.failed ?? 0;
  const attempted = pending + failed;
  const cancelled = bs.cancelled ?? 0;
  const ab = data.activity.abandoned;
  // Of everyone who got past the cart, what share actually paid.
  const conv = Math.round((paid / Math.max(1, paid + attempted + ab.count)) * 100);
  const fmax = Math.max(1, paid, attempted, ab.count);
  const isPaid = (s: string): boolean => ['processing', 'shipped', 'delivered'].includes(s);
  const isAttempt = (s: string): boolean => ['pending', 'failed'].includes(s);
  const list = sub === 'came' ? data.orders.recent.filter((o) => isPaid(o.status))
    : sub === 'att' ? data.orders.recent.filter((o) => isAttempt(o.status)) : [];
  const fbar = (label: string, val: string, n: number, color: string): ReactNode => <>
    <div className="dsh-frow"><span>{label}</span><strong>{val}</strong></div>
    <div className="dsh-bar" style={{ height: 13 }}><span style={{ width: (n / fmax) * 100 + '%', background: color }} /></div>
  </>;
  return (
    <div className="dsh-card">
      <CardHead title="Purchase activity" tint="var(--dt-green)" right={<button className="dsh-chip act" onClick={ctx.refresh}>↻ Refresh</button>} />
      <div className="dsh-cb">
        <div className="dsh-grid3">
          <div className="dsh-tile t-green"><div className="dsh-lbl">Came through</div><div className="dsh-kpi sm" style={{ marginTop: 6 }}>{paid}</div><div className="dsh-ms">paid orders</div></div>
          <div className="dsh-tile t-amber"><div className="dsh-lbl">Attempted</div><div className="dsh-kpi sm" style={{ marginTop: 6 }}>{attempted}</div><div className="dsh-ms">{pending} pending · {failed} failed</div></div>
          <div className="dsh-tile t-rose"><div className="dsh-lbl">Abandoned carts</div><div className="dsh-kpi sm" style={{ marginTop: 6 }}>{ab.count}</div><div className="dsh-ms">{usd(ab.valueCents)} at risk</div></div>
        </div>
        <div className="dsh-subs" style={{ marginTop: 16 }}>{[['fun', 'Funnel'], ['came', 'Came through'], ['att', 'Attempts']].map(([k, l]) => <button key={k} className={'dsh-st' + (sub === k ? ' on' : '')} onClick={() => { setSub(k); setExp(null); }}>{l}</button>)}</div>
        {sub === 'fun' && <div style={{ marginTop: 12 }}>
          {fbar('Open carts (live)', ab.count + ' · ' + usd(ab.valueCents), ab.count, 'linear-gradient(90deg,#f43f5e,#fb7185)')}
          {fbar('Checkout started, unfinished', String(attempted), attempted, 'linear-gradient(90deg,#f59e0b,#fbbf24)')}
          {fbar('Completed (paid)', String(paid), paid, 'linear-gradient(90deg,#16a34a,#4ade80)')}
          <StatGrid cells={[['Revenue 30d', usd(data.orders.revenueCents)], ['AOV', usd(data.orders.aovCents)], ['Cancelled', String(cancelled)], ['Checkout conv', conv + '%']]} />
        </div>}
        {(sub === 'came' || sub === 'att') && <div style={{ marginTop: 12 }}>
          {list.length ? list.map((o, i) => <div key={i}>
            <div className="dsh-row exp" onClick={() => setExp(exp === i ? null : i)}><div className="dsh-pfp">{initials(o.who)}</div><div style={{ minWidth: 0 }}><div className="dsh-rn">{o.who}</div><div className="dsh-re">SMNY-…{o.number}</div></div><span className={'dsh-pill ' + pillClass(o.status)} style={{ marginLeft: 'auto' }}>{o.status}</span><div className="dsh-rt">{usd(o.total)}</div></div>
            <div className={'dsh-detail' + (exp === i ? ' open' : '')}>{o.items.length ? o.items.map((it, j) => <div className="dsh-di" key={j}><span>{it.qty}× {it.name}</span><span>{usd(it.total)}</span></div>) : <div className="dsh-di"><span>Migrated order — line items in record</span><span></span></div>}</div>
          </div>) : <p className="dsh-empty">{sub === 'came' ? 'No completed orders in the recent window.' : 'No unfinished checkouts in the recent window. Live abandoned carts show under Funnel.'}</p>}
        </div>}
      </div>
    </div>
  );
}

function WRevenue({ data }: { data: DashData }) {
  return <div className="dsh-card"><CardHead title="Revenue & orders" tint="var(--dt-green)" /><div className="dsh-cb"><div className="dsh-krow"><div className="dsh-kpi">{usd(data.orders.revenueCents)}</div><div className="dsh-lbl" style={{ paddingBottom: 5 }}>30 days</div></div><RevChart series={data.orders.series} /><StatGrid cells={[['Orders', String(data.orders.total)], ['30d', String(data.orders.last30d)], ['AOV', usd(data.orders.aovCents)], ['Refunds', '$0']]} /></div></div>;
}
function WPayments() {
  return <div className="dsh-card"><CardHead title="Payments" right={<span className="dsh-pill info">12 methods</span>} /><div className="dsh-cb"><Bar label="Card" w={72} color="linear-gradient(90deg,#635bff,#f5389a)" val="72%" /><Bar label="Wallet" w={19} color="#3b82f6" val="19%" /><Bar label="BNPL" w={9} color="#8a2be2" val="9%" /><div className="dsh-chips" style={{ marginTop: 14 }}>{[['Stripe', '#635bff'], ['WooPay', '#22c55e'], ['PayPal', '#0070ba'], ['Apple Pay', '#111']].map(([n, c]) => <span className="dsh-chip" key={n}><span className="dsh-cd" style={{ background: c }} />{n}</span>)}</div></div></div>;
}
function WFulfillment() {
  return <div className="dsh-card"><CardHead title="Fulfillment" right={<span className="dsh-pill pend">check</span>} /><div className="dsh-cb"><div className="dsh-row"><div className="dsh-pfp">PF</div><div><div className="dsh-rn">Printful</div><div className="dsh-re">card expired — reconnect</div></div><div className="dsh-rt">8</div></div><div className="dsh-row"><div className="dsh-pfp">PY</div><div className="dsh-rn">Printify</div><div className="dsh-rt">22</div></div><div className="dsh-row"><div className="dsh-pfp">TS</div><div><div className="dsh-rn">Tapstitch</div><div className="dsh-re">not connected</div></div><div className="dsh-rt">11</div></div></div></div>;
}
function WCatalog({ data }: { data: DashData }) {
  return <div className="dsh-card"><CardHead title="Catalog & connectors" /><div className="dsh-cb"><div className="dsh-metrics"><div><div className="dsh-ms">Products</div><div className="dsh-mv">{data.products.total}</div></div><div><div className="dsh-ms">Variants</div><div className="dsh-mv">{data.products.variants.toLocaleString()}</div></div><div><div className="dsh-ms">Connectors</div><div className="dsh-mv">76</div></div><div><div className="dsh-ms">Feed items</div><div className="dsh-mv">517</div></div></div><div className="dsh-chips" style={{ marginTop: 14 }}><span className="dsh-chip"><span className="dsh-cd" style={{ background: '#22c55e' }} />Woo-compat live</span><span className="dsh-chip"><span className="dsh-cd" style={{ background: '#22c55e' }} />Meta feed live</span></div></div></div>;
}
function WPages({ data }: { data: DashData }) {
  const [sub, setSub] = useState('all');
  const list = sub === 'all' ? [...data.pages.recent, ...data.posts.recent] : sub === 'pg' ? data.pages.recent : data.posts.recent;
  const sorted = [...list].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, 7);
  return <div className="dsh-card"><CardHead title="Pages & journal" tint="var(--dt-blue)" right={<div className="dsh-subs">{[['all', 'All'], ['pg', 'Pages'], ['po', 'Journal']].map(([k, l]) => <button key={k} className={'dsh-st' + (sub === k ? ' on' : '')} onClick={() => setSub(k)}>{l}</button>)}</div>} /><div className="dsh-cb">{sorted.length ? sorted.map((c, i) => <div className="dsh-row" key={i}><div style={{ minWidth: 0 }}><div className="dsh-rn">{c.title || 'Untitled'}</div><div className="dsh-re">{c.type} · {timeAgo(c.updatedAt)}</div></div><span className={'dsh-pill ' + pillClass(c.status)} style={{ marginLeft: 'auto' }}>{c.status}</span></div>) : <p className="dsh-empty">Nothing here yet.</p>}<div className="dsh-chips" style={{ marginTop: 14 }}><a className="dsh-chip act" href={`${BASE_PATH}/pages`}>+ New page</a><a className="dsh-chip act" href={`${BASE_PATH}/posts`}>+ New post</a></div></div></div>;
}
function WContentStats({ data }: { data: DashData }) {
  return <div className="dsh-card"><CardHead title="Content at a glance" /><div className="dsh-cb"><div className="dsh-grid2"><div className="dsh-tile t-blue"><div className="dsh-lbl">Pages</div><div className="dsh-kpi sm" style={{ marginTop: 6 }}>{data.pages.total}</div></div><div className="dsh-tile t-violet"><div className="dsh-lbl">Journal</div><div className="dsh-kpi sm" style={{ marginTop: 6 }}>{data.posts.total}</div></div></div><div className="dsh-metrics"><div><div className="dsh-ms">Published</div><div className="dsh-mv">{data.pages.published + data.posts.published}</div></div><div><div className="dsh-ms">Drafts</div><div className="dsh-mv">{data.pages.draft + data.posts.draft}</div></div></div></div></div>;
}
function WSources({ data }: { data: DashData }) {
  const [sub, setSub] = useState('src');
  const tot = Math.max(1, data.activity.sources.reduce((s, x) => s + x.orders, 0));
  return <div className="dsh-card"><CardHead title="Where orders come from" tint="var(--dt-ink)" right={<div className="dsh-subs">{[['src', 'Sources'], ['fun', 'Funnel']].map(([k, l]) => <button key={k} className={'dsh-st' + (sub === k ? ' on' : '')} onClick={() => setSub(k)}>{l}</button>)}</div>} /><div className="dsh-cb">{sub === 'src' ? (data.activity.sources.length ? data.activity.sources.slice(0, 5).map((s, i) => <Bar key={s.source} label={s.source} w={(s.orders / tot) * 100} color={i === 0 ? '#22c55e' : 'linear-gradient(90deg,#f5389a,#ff8a3d)'} val={String(s.orders)} />) : <p className="dsh-empty">No attributed orders in 30 days yet. Land with <code>?utm_source=instagram</code> and it populates.</p>) : <>
    <div className="dsh-frow"><span>Visits</span><strong>—</strong></div><div className="dsh-bar" style={{ height: 13 }}><span style={{ width: '100%', background: 'linear-gradient(90deg,#60a5fa,#818cf8)' }} /></div>
    <div className="dsh-frow"><span>Added to cart</span><strong>{data.activity.abandoned.count + data.orders.total}</strong></div><div className="dsh-bar" style={{ height: 13 }}><span style={{ width: '40%', background: 'linear-gradient(90deg,#34d399,#10b981)' }} /></div>
    <div className="dsh-frow"><span>Ordered</span><strong>{data.orders.total}</strong></div><div className="dsh-bar" style={{ height: 13 }}><span style={{ width: '18%', background: 'linear-gradient(90deg,#f5389a,#ff8a3d)' }} /></div>
  </>}</div></div>;
}
function WIssues({ data }: { data: DashData }) {
  const bad = data.health.checks.filter((c) => c.status !== 'ok');
  const pend = data.orders.byStatus.pending ?? 0, fail = data.orders.byStatus.failed ?? 0;
  const has = bad.length || pend || fail;
  return <div className="dsh-card"><CardHead title="Issues to watch" right={has ? <span className="dsh-pill pend">{bad.length + (pend ? 1 : 0) + (fail ? 1 : 0)} open</span> : <span className="dsh-pill ok">clear</span>} /><div className="dsh-cb">{bad.map((c, i) => <div className="dsh-check" key={'b' + i}><Dot s={c.status} /><div><div className="dsh-ckt">{c.label}</div><div className="dsh-ckd">{c.detail}</div></div></div>)}{pend > 0 && <div className="dsh-check"><Dot s="warn" /><div><div className="dsh-ckt">{pend} order(s) pending</div><div className="dsh-ckd">awaiting payment or fulfillment</div></div></div>}{fail > 0 && <div className="dsh-check"><Dot s="error" /><div><div className="dsh-ckt">{fail} failed order(s)</div><div className="dsh-ckd">payment did not complete</div></div></div>}{!has && <p className="dsh-empty">Nothing needs attention.</p>}</div></div>;
}
function WAI({ ctx }: { ctx: Ctx }) {
  return <div className="dsh-card"><CardHead title="Studio AI" tint="var(--brand)" /><div className="dsh-cb dsh-ai">{ctx.studioAgent}</div></div>;
}

/* ─────────────────────────── registry ─────────────────────────── */
const WIDGETS: Record<string, { name: string; size: Size; Comp: (p: { data: DashData; ctx: Ctx }) => ReactNode }> = {
  commerce: { name: 'Commerce (merged)', size: 'lg', Comp: ({ data }) => <WCommerce data={data} /> },
  website: { name: 'Website status', size: 'sm', Comp: ({ data, ctx }) => <WWebsite data={data} ctx={ctx} /> },
  audience: { name: 'Audience', size: 'sm', Comp: ({ data }) => <WAudience data={data} /> },
  purchases: { name: 'Purchase activity', size: 'lg', Comp: ({ data, ctx }) => <WPurchases data={data} ctx={ctx} /> },
  activity: { name: 'Recent activity', size: 'lg', Comp: ({ data, ctx }) => <WActivity data={data} ctx={ctx} /> },
  revenue: { name: 'Revenue chart', size: 'lg', Comp: ({ data }) => <WRevenue data={data} /> },
  payments: { name: 'Payments mix', size: 'sm', Comp: () => <WPayments /> },
  fulfillment: { name: 'Fulfillment', size: 'sm', Comp: () => <WFulfillment /> },
  catalog: { name: 'Catalog & connectors', size: 'lg', Comp: ({ data }) => <WCatalog data={data} /> },
  pages: { name: 'Pages & journal', size: 'md', Comp: ({ data }) => <WPages data={data} /> },
  contentStats: { name: 'Content stats', size: 'sm', Comp: ({ data }) => <WContentStats data={data} /> },
  sources: { name: 'Order sources', size: 'md', Comp: ({ data }) => <WSources data={data} /> },
  issues: { name: 'Issues to watch', size: 'sm', Comp: ({ data }) => <WIssues data={data} /> },
  ai: { name: 'Studio AI', size: 'lg', Comp: ({ ctx }) => <WAI ctx={ctx} /> },
};
const DEFAULTS: Record<string, W[]> = {
  overview: [{ id: 'commerce', size: 'lg' }, { id: 'website', size: 'sm' }, { id: 'audience', size: 'sm' }, { id: 'purchases', size: 'lg' }],
  counter: [{ id: 'revenue', size: 'lg' }, { id: 'payments', size: 'sm' }, { id: 'fulfillment', size: 'sm' }, { id: 'catalog', size: 'lg' }],
  content: [{ id: 'pages', size: 'md' }, { id: 'contentStats', size: 'sm' }],
  growth: [{ id: 'purchases', size: 'lg' }, { id: 'sources', size: 'md' }, { id: 'issues', size: 'sm' }, { id: 'ai', size: 'lg' }],
};
const SPAN: Record<Size, number> = { xs: 3, sm: 6, md: 9, lg: 12 };
const NEXT_SIZE: Record<Size, Size> = { xs: 'sm', sm: 'md', md: 'lg', lg: 'xs' };

/* ─────────────────────────── shell ─────────────────────────── */
export function DashboardTabs({ data, studioAgent }: { data: DashData; studioAgent: ReactNode }) {
  const router = useRouter();
  const [tab, setTab] = useState('overview');
  const [edit, setEdit] = useState(false);
  const [palette, setPalette] = useState(false);
  const [layouts, setLayouts] = useState<Record<string, W[]>>(DEFAULTS);
  const [customTabs, setCustomTabs] = useState<string[]>([]);
  const [refreshedAt] = useState(() => Date.now());

  useEffect(() => {
    try {
      const l = JSON.parse(localStorage.getItem('dsh_layouts_v2') || 'null');
      let merged: Record<string, W[]> = (l && typeof l === 'object') ? { ...DEFAULTS, ...l } : { ...DEFAULTS };
      // The Purchase-activity widget shipped after this layout store existed, so
      // a saved layout would never contain it. Inject it once at the top of its
      // home tabs (Overview, Growth) and remember we did — so if it is later
      // removed on purpose, it stays gone rather than reappearing every load.
      if (!localStorage.getItem('dsh_pin_purchases')) {
        for (const t of ['overview', 'growth']) {
          const arr = merged[t] ? [...merged[t]] : (DEFAULTS[t] ? [...DEFAULTS[t]!] : []);
          if (!arr.some((w) => w.id === 'purchases')) arr.unshift({ id: 'purchases', size: 'lg' });
          merged[t] = arr;
        }
        localStorage.setItem('dsh_pin_purchases', '1');
        localStorage.setItem('dsh_layouts_v2', JSON.stringify(merged));
      }
      setLayouts(merged);
      const t = JSON.parse(localStorage.getItem('dsh_tabs_v2') || '[]');
      if (Array.isArray(t)) setCustomTabs(t);
    } catch { /* ignore */ }
  }, []);
  const persist = (next: Record<string, W[]>) => { setLayouts(next); try { localStorage.setItem('dsh_layouts_v2', JSON.stringify(next)); } catch { /* ignore */ } };
  const persistTabs = (next: string[]) => { setCustomTabs(next); try { localStorage.setItem('dsh_tabs_v2', JSON.stringify(next)); } catch { /* ignore */ } };

  const ctx: Ctx = useMemo(() => ({ studioAgent, refresh: () => router.refresh(), refreshedLabel: timeAgo(new Date(refreshedAt).toISOString()) + ' ago' }), [studioAgent, router, refreshedAt]);
  const cur = layouts[tab] ?? [];
  const setCur = (next: W[]) => persist({ ...layouts, [tab]: next });

  const TABS = [{ id: 'overview', label: 'Overview' }, ...(data.commerceActive ? [{ id: 'counter', label: 'Counter' }] : []), { id: 'content', label: 'Content' }, { id: 'growth', label: 'Growth' }, ...customTabs.map((c, i) => ({ id: 'custom:' + i, label: c }))];
  const titles: Record<string, [string, string]> = { overview: ['Overview', 'Every domain of the site — one card each'], counter: ['Counter', 'Commerce in depth'], content: ['Content', 'Pages, journal and media'], growth: ['Growth', 'Sources, funnel, issues and AI'] };
  const ttl = tab.startsWith('custom:') ? [customTabs[Number(tab.split(':')[1])] || 'Dashboard', 'Your custom view'] : (titles[tab] ?? titles.overview);

  const addCustom = () => { const n = (window.prompt('Name your dashboard') || '').trim().slice(0, 40); if (!n) return; const next = [...customTabs, n]; persistTabs(next); persist({ ...layouts, ['custom:' + (next.length - 1)]: [] }); setTab('custom:' + (next.length - 1)); };

  return (
    <section className="dsh">
      <style>{CSS}</style>
      <div className="dsh-top">
        <div><div className="dsh-eyebrow">{data.storeName}</div><h1 className="dsh-h1">{ttl[0]}</h1><p className="dsh-sub">{ttl[1]}</p></div>
        <div className="dsh-topact">
          <button className="dsh-btn" onClick={() => router.refresh()}>↻ Refresh</button>
          <button className={'dsh-btn' + (edit ? ' on' : '')} onClick={() => setEdit(!edit)}>{edit ? 'Done' : 'Edit layout'}</button>
          {edit && <button className="dsh-btn" onClick={() => setCur(DEFAULTS[tab] ? [...DEFAULTS[tab]] : [])}>Reset</button>}
        </div>
      </div>

      <div className="dsh-tabs">
        {TABS.map((t) => <button key={t.id} className={'dsh-tab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>{t.label}</button>)}
        <button className="dsh-tab dsh-add" title="Add a custom dashboard" onClick={addCustom}>+</button>
      </div>

      <div className="dsh-bento">
        {cur.map((w, i) => (
          <div key={w.id + i} className={'dsh-cell s' + SPAN[w.size] + (edit ? ' editing' : '')}>
            {edit && <div className="dsh-wc">
              <button title="Resize" onClick={() => setCur(cur.map((x, j) => j === i ? { ...x, size: NEXT_SIZE[x.size] } : x))}>⤢</button>
              <button title="Up" disabled={i === 0} onClick={() => { const n = [...cur];[n[i - 1], n[i]] = [n[i], n[i - 1]]; setCur(n); }}>↑</button>
              <button title="Down" disabled={i === cur.length - 1} onClick={() => { const n = [...cur];[n[i + 1], n[i]] = [n[i], n[i + 1]]; setCur(n); }}>↓</button>
              <button title="Remove" onClick={() => setCur(cur.filter((_, j) => j !== i))}>×</button>
            </div>}
            {WIDGETS[w.id] ? WIDGETS[w.id].Comp({ data, ctx }) : <div className="dsh-card"><div className="dsh-cb dsh-empty">Unknown widget</div></div>}
          </div>
        ))}
        {!cur.length && <div className="dsh-cell s12"><div className="dsh-card"><div className="dsh-cb" style={{ textAlign: 'center', padding: 30 }}><p className="dsh-empty">Empty dashboard. Add widgets to build it.</p><button className="dsh-btn on" style={{ marginTop: 10 }} onClick={() => { setEdit(true); setPalette(true); }}>+ Add widget</button></div></div></div>}
        {edit && <div className="dsh-cell s12"><button className="dsh-addw" onClick={() => setPalette(true)}>+ Add widget</button></div>}
      </div>

      {palette && <div className="dsh-modal" onClick={() => setPalette(false)}>
        <div className="dsh-palette" onClick={(e) => e.stopPropagation()}>
          <div className="dsh-ph"><strong>Add a widget</strong><button onClick={() => setPalette(false)}>×</button></div>
          <div className="dsh-pgrid">
            {Object.entries(WIDGETS).map(([id, w]) => <button key={id} className="dsh-pw" onClick={() => { setCur([...cur, { id, size: w.size }]); setPalette(false); }}><span className="dsh-pwn">{w.name}</span><span className="dsh-pws">{w.size}</span></button>)}
          </div>
        </div>
      </div>}
    </section>
  );
}

const CSS = `
.dsh{--dt-ink:linear-gradient(155deg,#181c24,#0c0e13);--dt-green:linear-gradient(150deg,#d7f6e3,#a7ead0);--dt-mint:linear-gradient(155deg,#e6f8ec,#c9f0d9);--dt-amber:linear-gradient(150deg,#fdeecb,#fcd9a4);--dt-rose:linear-gradient(150deg,#fde4e7,#fbccd2);--dt-blue:linear-gradient(155deg,#dde9fd,#bcd3fb);--dt-violet:linear-gradient(155deg,#ece7fe,#d4c8fc);--dt-fade:rgba(14,17,22,.05);--dt-sh:0 1px 2px rgba(14,17,22,.04),0 10px 26px -14px rgba(14,17,22,.16);--brand:#f5389a;color:inherit}
[data-color-mode='dark'] .dsh{--dt-green:linear-gradient(150deg,#123720,#0d2a19);--dt-mint:linear-gradient(155deg,#123020,#0e2519);--dt-amber:linear-gradient(150deg,#3a2a10,#2b1f0c);--dt-rose:linear-gradient(150deg,#3a1720,#2b1016);--dt-blue:linear-gradient(155deg,#132338,#0e1a2c);--dt-violet:linear-gradient(155deg,#231b3c,#1a142c);--dt-ink:linear-gradient(155deg,#1c212b,#0e1117);--dt-fade:rgba(255,255,255,.06);--dt-sh:0 1px 2px rgba(0,0,0,.4),0 14px 34px -16px rgba(0,0,0,.7)}
@media (prefers-color-scheme:dark){[data-color-mode='system'] .dsh{--dt-green:linear-gradient(150deg,#123720,#0d2a19);--dt-mint:linear-gradient(155deg,#123020,#0e2519);--dt-amber:linear-gradient(150deg,#3a2a10,#2b1f0c);--dt-rose:linear-gradient(150deg,#3a1720,#2b1016);--dt-blue:linear-gradient(155deg,#132338,#0e1a2c);--dt-violet:linear-gradient(155deg,#231b3c,#1a142c);--dt-ink:linear-gradient(155deg,#1c212b,#0e1117);--dt-fade:rgba(255,255,255,.06);--dt-sh:0 1px 2px rgba(0,0,0,.4),0 14px 34px -16px rgba(0,0,0,.7)}}
.dsh-top{display:flex;align-items:flex-start;gap:16px;padding:4px 0 0}
.dsh-eyebrow{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--th-muted)}
.dsh-h1{margin:6px 0 0;font-size:28px;font-weight:800;letter-spacing:-.03em}.dsh-sub{margin:4px 0 0;color:var(--th-muted);font-size:13.5px}
.dsh-topact{margin-left:auto;display:flex;gap:8px;flex:none}
.dsh-btn{padding:8px 14px;border-radius:10px;border:1px solid var(--th-line);background:var(--th-card-bg);color:inherit;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
.dsh-btn:hover{border-color:var(--th-muted)}.dsh-btn.on{background:var(--th-text,#111);color:var(--th-bg);border-color:transparent}
.dsh-tabs{display:flex;flex-wrap:wrap;gap:5px;margin:16px 0 18px}
.dsh-tab{padding:8px 16px;border-radius:10px;border:1px solid transparent;background:none;color:var(--th-muted);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.dsh-tab:hover{color:inherit}.dsh-tab.on{background:var(--th-card-bg);color:inherit;border-color:var(--th-line);box-shadow:var(--dt-sh)}
.dsh-add{width:34px;padding:8px 0;font-size:16px;color:var(--th-muted)}
.dsh-bento{display:grid;grid-template-columns:repeat(12,1fr);gap:16px;align-items:start}
.dsh-cell{min-width:0;position:relative}
.s3{grid-column:span 3}.s6{grid-column:span 6}.s9{grid-column:span 9}.s12{grid-column:span 12}
.dsh-cell.editing{outline:1px dashed var(--th-line2,var(--th-line));outline-offset:4px;border-radius:20px}
.dsh-wc{position:absolute;top:-11px;right:8px;z-index:4;display:flex;gap:3px;background:var(--th-card-bg);border:1px solid var(--th-line);border-radius:9px;padding:3px;box-shadow:var(--dt-sh)}
.dsh-wc button{width:24px;height:24px;border:none;background:none;color:var(--th-muted);cursor:pointer;border-radius:6px;font-size:13px}
.dsh-wc button:hover{background:var(--dt-fade);color:inherit}.dsh-wc button:disabled{opacity:.3;cursor:default}
.dsh-addw{width:100%;padding:14px;border:1px dashed var(--th-line2,var(--th-line));background:none;border-radius:16px;color:var(--th-muted);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.dsh-addw:hover{color:inherit;border-color:var(--th-muted)}
.dsh-card{background:var(--th-card-bg);border:1px solid var(--th-line);border-radius:18px;box-shadow:var(--dt-sh);overflow:hidden}
.dsh-ch{display:flex;align-items:center;gap:10px;padding:15px 18px;border-bottom:1px solid var(--th-line)}
.dsh-ch h3{margin:0;font-size:14px;font-weight:700;letter-spacing:-.01em;display:flex;align-items:center;gap:8px}
.dsh-hic{width:10px;height:10px;border-radius:4px;flex:none}
.dsh-subs{display:inline-flex;gap:2px}
.dsh-st{border:none;background:none;font:inherit;font-size:12px;font-weight:600;color:var(--th-muted);padding:5px 9px;cursor:pointer;border-radius:7px}
.dsh-st:hover{color:inherit}.dsh-st.on{color:inherit;background:var(--dt-fade)}
.dsh-cb{padding:18px}
.dsh-krow{display:flex;align-items:flex-end;gap:12px}
.dsh-kpi{font-size:38px;font-weight:800;letter-spacing:-.035em;line-height:1;font-variant-numeric:tabular-nums}.dsh-kpi.sm{font-size:25px}
.dsh-lbl{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--th-muted)}
.dsh-statgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;margin-top:16px;background:var(--th-line);border-radius:12px;overflow:hidden;border:1px solid var(--th-line)}
.dsh-statgrid>div{background:var(--th-card-bg);padding:12px 13px}
.dsh-mlbl{font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--th-muted)}
.dsh-v{font-size:18px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;margin-top:3px}.dsh-ms{font-size:10px;color:var(--th-muted);margin-top:2px}
.dsh-row{display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--th-line)}.dsh-row:last-child{border-bottom:none}
.dsh-row.exp{cursor:pointer}.dsh-row.exp:hover{background:var(--dt-fade);margin:0 -18px;padding-left:18px;padding-right:18px}
.dsh-pfp{width:30px;height:30px;border-radius:8px;background:var(--dt-fade);display:grid;place-items:center;font-weight:700;font-size:11px;color:var(--th-muted);flex:none}
.dsh-rn{font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dsh-re{font-size:11px;color:var(--th-muted)}
.dsh-rt{margin-left:14px;font-weight:700;font-variant-numeric:tabular-nums;font-size:13.5px;flex:none}
.dsh-pill{font-size:10px;font-weight:700;padding:3px 8px;border-radius:999px}
.dsh-pill.ok{background:rgba(22,163,74,.13);color:#16a34a}.dsh-pill.pend{background:rgba(217,119,6,.15);color:#d97706}.dsh-pill.can{background:var(--dt-fade);color:var(--th-muted)}.dsh-pill.info{background:rgba(59,130,246,.13);color:#3b82f6}
.dsh-detail{max-height:0;overflow:hidden;transition:max-height .26s ease;font-size:12px;color:var(--th-muted)}.dsh-detail.open{max-height:180px}
.dsh-di{padding:7px 0 7px 41px;border-bottom:1px dashed var(--th-line);display:flex;justify-content:space-between}
.dsh-barrow{display:flex;align-items:center;gap:11px;margin-top:10px;font-size:12px}
.dsh-bn{width:120px;color:var(--th-muted);flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-bar{height:9px;border-radius:6px;background:var(--dt-fade);flex:1;overflow:hidden}.dsh-bar>span{display:block;height:100%;border-radius:6px}
.dsh-bv{width:52px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;flex:none;font-size:12px}
.dsh-dot{width:9px;height:9px;border-radius:50%;flex:none;margin-top:4px}
.dsh-check{display:flex;align-items:flex-start;gap:11px;padding:10px 0;border-bottom:1px solid var(--th-line)}.dsh-check:last-child{border-bottom:none}
.dsh-ckt{font-weight:600;font-size:12.5px}.dsh-ckd{font-size:11px;color:var(--th-muted);margin-top:1px}
.dsh-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--th-line);border-radius:11px;overflow:hidden;border:1px solid var(--th-line);margin-top:14px}
.dsh-metrics>div{background:var(--th-card-bg);padding:10px 12px}.dsh-mv{font-weight:800;font-size:15px;margin-top:2px;letter-spacing:-.01em}
.dsh-chips{display:flex;flex-wrap:wrap;gap:7px}
.dsh-chip{font-size:11.5px;font-weight:600;padding:7px 11px;border-radius:9px;background:var(--th-surface,var(--dt-fade));border:1px solid var(--th-line);display:flex;align-items:center;gap:7px;color:inherit;text-decoration:none}
a.dsh-chip.act,.dsh-chip.act{cursor:pointer}a.dsh-chip.act:hover{border-color:var(--th-muted)}
.dsh-cd{width:7px;height:7px;border-radius:50%;flex:none}
.dsh-tile{border-radius:14px;padding:14px 16px;border:1px solid var(--th-line)}
.dsh-tile.t-violet{background:var(--dt-violet)}.dsh-tile.t-mint{background:var(--dt-mint)}.dsh-tile.t-blue{background:var(--dt-blue)}.dsh-tile.t-green{background:var(--dt-green)}.dsh-tile.t-amber{background:var(--dt-amber)}.dsh-tile.t-rose{background:var(--dt-rose)}
.dsh-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.dsh-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}@media (max-width:640px){.dsh-grid3{grid-template-columns:1fr}}
.dsh-empty{color:var(--th-muted);font-size:12.5px;margin:4px 0}
.dsh-feed{position:relative;padding-left:16px}
.dsh-fe{position:relative;padding:8px 0;border-bottom:1px solid var(--th-line)}.dsh-fe:last-child{border-bottom:none}
.dsh-fe::before{content:"";position:absolute;left:-12px;top:13px;width:8px;height:8px;border-radius:50%;background:var(--th-muted);box-shadow:0 0 0 3px var(--th-card-bg)}
.dsh-fe.g::before{background:#22c55e}.dsh-fe.p::before{background:var(--brand)}
.dsh-feed::after{content:"";position:absolute;left:-8px;top:4px;bottom:4px;width:2px;background:var(--th-line)}
.dsh-ft{font-size:12.5px;font-weight:600}.dsh-fm{font-size:11px;color:var(--th-muted);margin-top:1px}
.dsh-frow{display:flex;justify-content:space-between;font-size:12px;color:var(--th-muted);margin:11px 0 5px}.dsh-frow strong{color:inherit}
.dsh-chart{position:relative;margin-top:14px}.dsh-chart svg{width:100%;height:150px;display:block;overflow:visible}
.dsh-cgrid line{stroke:var(--th-line);stroke-width:1}
.dsh-tip{position:absolute;pointer-events:none;background:var(--th-text,#111);color:var(--th-bg);font-size:11.5px;font-weight:700;padding:4px 9px;border-radius:8px;transform:translate(-50%,-135%);white-space:nowrap;z-index:5}
.dsh-xax{display:flex;justify-content:space-between;font-size:10px;color:var(--th-muted);margin-top:7px}
.dsh-ai > *{max-width:100%}
.dsh-modal{position:fixed;inset:0;background:rgba(8,10,14,.5);display:grid;place-items:center;z-index:60;padding:20px}
.dsh-palette{background:var(--th-card-bg);border:1px solid var(--th-line);border-radius:18px;width:min(560px,100%);max-height:80vh;overflow:auto;box-shadow:0 30px 80px -20px rgba(0,0,0,.5)}
.dsh-ph{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--th-line)}
.dsh-ph button{border:none;background:none;font-size:20px;color:var(--th-muted);cursor:pointer}
.dsh-pgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:16px}
.dsh-pw{display:flex;align-items:center;justify-content:space-between;padding:14px;border:1px solid var(--th-line);border-radius:12px;background:none;color:inherit;font:inherit;cursor:pointer;text-align:left}
.dsh-pw:hover{border-color:var(--brand)}.dsh-pwn{font-weight:600;font-size:13px}.dsh-pws{font-size:10px;color:var(--th-muted);text-transform:uppercase}
@media(max-width:1120px){.dsh-bento{grid-template-columns:repeat(6,1fr)}.s3{grid-column:span 3}.s6,.s9,.s12{grid-column:span 6}.dsh-statgrid,.dsh-metrics{grid-template-columns:repeat(2,1fr)}}
@media(max-width:640px){.dsh-bento{grid-template-columns:1fr}[class*=" s"],[class^=s]{grid-column:span 1!important}.dsh-pgrid{grid-template-columns:1fr}.dsh-h1{font-size:23px}}
`;
