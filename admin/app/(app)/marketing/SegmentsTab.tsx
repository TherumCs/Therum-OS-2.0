'use client';

import { useEffect, useRef, useState } from 'react';
import { api, type ListRow } from './MarketingClient';

export interface SegmentRow {
  id: string;
  name: string;
  rules: RuleSet;
  count: number;
  createdAt: string;
}
interface Rule {
  type: string;
  op: string;
  value?: unknown;
}
interface RuleSet {
  match: 'all' | 'any';
  rules: Rule[];
}
interface Options {
  categories: { id: string; name: string; parentId: string | null }[];
  lists: { id: string; name: string }[];
  sources: string[];
  tags: string[];
}

// Each rule type: label, the ops it accepts, and what kind of value it wants.
const RULE_DEFS: Record<string, { label: string; ops: [string, string][]; value: 'none' | 'text' | 'number' | 'money' | 'days' | 'list' | 'category' | 'product' | 'source' | 'tag' }> = {
  bought_product: { label: 'Bought product', ops: [['yes', 'has bought'], ['no', 'has not bought']], value: 'product' },
  bought_category: { label: 'Bought from category', ops: [['yes', 'has bought'], ['no', 'has not bought']], value: 'category' },
  orders_count: { label: 'Number of orders', ops: [['gte', 'at least'], ['lte', 'at most'], ['eq', 'exactly']], value: 'number' },
  spent: { label: 'Total spent', ops: [['gte', 'at least'], ['lte', 'at most']], value: 'money' },
  last_order_days: { label: 'Last order', ops: [['within', 'within the last'], ['not_within', 'NOT within the last']], value: 'days' },
  subscribed_days: { label: 'Subscribed', ops: [['within', 'within the last'], ['not_within', 'NOT within the last']], value: 'days' },
  engaged: { label: 'Engagement', ops: [['opened', 'opened an email in the last'], ['clicked', 'clicked an email in the last'], ['not_opened', 'opened nothing in the last']], value: 'days' },
  list: { label: 'On list', ops: [['in', 'is on'], ['not', 'is not on']], value: 'list' },
  tag: { label: 'Tag', ops: [['has', 'has tag'], ['not', 'does not have tag']], value: 'tag' },
  source: { label: 'Signed up via', ops: [['is', 'is'], ['not', 'is not']], value: 'source' },
  has_phone: { label: 'Phone number', ops: [['yes', 'on file'], ['no', 'not on file']], value: 'none' },
};

const SOURCE_LABEL: Record<string, string> = { footer: 'Site footer', popup: 'Popup', embed: 'Embed', checkout: 'Checkout', customer: 'Customer', import: 'Import', manual: 'Added by hand', 'coming-soon': 'Coming soon' };

const newRule = (): Rule => ({ type: 'bought_category', op: 'yes', value: '' });

export function SegmentsTab({ initial, lists }: { initial: SegmentRow[]; lists: ListRow[] }) {
  const [rows, setRows] = useState<SegmentRow[]>(initial);
  const [opts, setOpts] = useState<Options | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; name: string; rules: RuleSet } | null>(null);
  const [preview, setPreview] = useState<{ count: number; sample: { email: string; firstName: string | null }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [productQ, setProductQ] = useState<Record<number, string>>({});
  const [productHits, setProductHits] = useState<Record<number, { name: string; slug: string; id?: string }[]>>({});
  const [productIds, setProductIds] = useState<Record<string, string>>({});

  useEffect(() => {
    void (async () => {
      try {
        setOpts((await api.get('segments/options')) as Options);
      } catch {
        /* builder still works with free-text values */
      }
    })();
  }, []);

  // Live count while editing.
  const timer = useRef<number | null>(null);
  const toCents = (rules: RuleSet): RuleSet => ({ ...rules, rules: rules.rules.map((r) => (RULE_DEFS[r.type]?.value === 'money' ? { ...r, value: Math.round(Number(r.value || 0) * 100) } : r)) });
  const runPreview = (rules: RuleSet) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        setPreview((await api.send('POST', 'segments/preview', toCents(rules))) as { count: number; sample: { email: string; firstName: string | null }[] });
      } catch {
        setPreview(null);
      }
    }, 300);
  };

  const start = (s?: SegmentRow) => {
    // Money rules are stored in cents; the builder edits dollars.
    const toDollars = (rs: Rule[]) => rs.map((r) => (RULE_DEFS[r.type]?.value === 'money' && typeof r.value === 'number' ? { ...r, value: r.value / 100 } : r));
    const e = s ? { id: s.id, name: s.name, rules: { match: s.rules?.match ?? 'all', rules: toDollars(s.rules?.rules ?? []) } } : { id: null, name: '', rules: { match: 'all' as const, rules: [newRule()] } };
    setEditing(e);
    setError('');
    runPreview(e.rules);
  };

  const setRules = (rules: RuleSet) => {
    if (!editing) return;
    setEditing({ ...editing, rules });
    runPreview(rules);
  };
  const patchRule = (i: number, p: Partial<Rule>) => {
    if (!editing) return;
    const rules = editing.rules.rules.map((r, j) => (j === i ? { ...r, ...p } : r));
    setRules({ ...editing.rules, rules });
  };
  const changeType = (i: number, type: string) => {
    const def = RULE_DEFS[type];
    patchRule(i, { type, op: def?.ops[0]?.[0] ?? '', value: def?.value === 'none' ? undefined : '' });
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError('');
    try {
      // Money is entered in dollars, stored in cents.
      const body = { name: editing.name, rules: toCents(editing.rules) };
      const row = (editing.id ? await api.send('PATCH', `segments/${editing.id}`, body) : await api.send('POST', 'segments', body)) as SegmentRow;
      const withCount = { ...row, count: preview?.count ?? 0 };
      setRows((rs) => (editing.id ? rs.map((x) => (x.id === row.id ? withCount : x)) : [...rs, withCount]));
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
    setBusy(false);
  };

  const remove = async (s: SegmentRow) => {
    if (!window.confirm(`Delete segment "${s.name}"? Campaigns that used it just stop narrowing by it.`)) return;
    setBusy(true);
    try {
      await api.send('DELETE', `segments/${s.id}`);
      setRows((rs) => rs.filter((x) => x.id !== s.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete.');
    }
    setBusy(false);
  };

  const searchProducts = async (i: number, q: string) => {
    setProductQ((m) => ({ ...m, [i]: q }));
    try {
      const hits = (await api.get(`products?q=${encodeURIComponent(q)}`)) as { name: string; slug: string; id?: string }[];
      setProductHits((m) => ({ ...m, [i]: hits }));
    } catch {
      /* best-effort */
    }
  };

  const valueField = (r: Rule, i: number) => {
    const def = RULE_DEFS[r.type];
    if (!def || def.value === 'none') return null;
    const v = r.value === undefined || r.value === null ? '' : String(r.value);
    switch (def.value) {
      case 'number':
        return <input type="number" min={0} value={v} onChange={(e) => patchRule(i, { value: Number(e.target.value) })} style={{ width: 90 }} />;
      case 'money':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            $ <input type="number" min={0} step="0.01" value={v} onChange={(e) => patchRule(i, { value: e.target.value })} style={{ width: 100 }} />
          </span>
        );
      case 'days':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input type="number" min={1} value={v} onChange={(e) => patchRule(i, { value: Number(e.target.value) })} style={{ width: 80 }} /> days
          </span>
        );
      case 'list':
        return (
          <select value={v} onChange={(e) => patchRule(i, { value: e.target.value })} style={{ width: 180 }}>
            <option value="">— pick a list —</option>
            {(opts?.lists ?? lists).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        );
      case 'category':
        return (
          <select value={v} onChange={(e) => patchRule(i, { value: e.target.value })} style={{ width: 200 }}>
            <option value="">— pick a category —</option>
            {(opts?.categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.parentId ? '  ↳ ' : ''}
                {c.name}
              </option>
            ))}
          </select>
        );
      case 'source':
        return (
          <select value={v} onChange={(e) => patchRule(i, { value: e.target.value })} style={{ width: 160 }}>
            <option value="">— pick —</option>
            {(opts?.sources ?? Object.keys(SOURCE_LABEL)).map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s] || s}
              </option>
            ))}
          </select>
        );
      case 'tag':
        return <input list={`tags-${i}`} value={v} onChange={(e) => patchRule(i, { value: e.target.value })} placeholder="tag" style={{ width: 140 }} />;
      case 'product':
        return (
          <span style={{ display: 'inline-grid', gap: 4 }}>
            <input value={productQ[i] ?? (productIds[v] || v)} onChange={(e) => void searchProducts(i, e.target.value)} placeholder="Search products…" style={{ width: 220 }} />
            {(productHits[i] ?? []).length > 0 && (
              <span style={{ display: 'grid', gap: 2, maxHeight: 140, overflow: 'auto' }}>
                {(productHits[i] ?? []).map((p) => (
                  <button
                    key={p.slug}
                    className="th-btn th-btn--xs"
                    style={{ justifyContent: 'flex-start' }}
                    onClick={() => {
                      // The rule needs the product ID; the picker only knows the slug, so the
                      // backend resolves slug → id at evaluation time via `value` prefix.
                      patchRule(i, { value: `slug:${p.slug}` });
                      setProductIds((m) => ({ ...m, [`slug:${p.slug}`]: p.name }));
                      setProductQ((m) => ({ ...m, [i]: p.name }));
                      setProductHits((m) => ({ ...m, [i]: [] }));
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </span>
            )}
          </span>
        );
      default:
        return <input value={v} onChange={(e) => patchRule(i, { value: e.target.value })} />;
    }
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--th-space-16)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="muted" style={{ fontSize: 'var(--th-fs-sm)' }}>
          A segment is a rule, not a list: “bought a jersey”, “no order in 90 days”, “opened something this month”. It is worked out fresh every time it is used.
        </span>
        <span style={{ flex: 1 }} />
        <button className="th-btn th-btn-primary" onClick={() => start()} disabled={busy || !!editing}>
          New segment
        </button>
      </div>
      {error && <div style={{ color: 'var(--th-danger-text)', fontSize: 13 }}>{error}</div>}

      {editing && (
        <div className="th-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Segment name (e.g. Jersey buyers)" style={{ maxWidth: 300, fontWeight: 600 }} />
            <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>People who match</span>
            <select value={editing.rules.match} onChange={(e) => setRules({ ...editing.rules, match: e.target.value as 'all' | 'any' })} style={{ width: 120 }}>
              <option value="all">all rules</option>
              <option value="any">any rule</option>
            </select>
            <span style={{ flex: 1 }} />
            {preview && (
              <span className="pill pill-ok" title={preview.sample.map((s) => s.email).join('\n')}>
                {preview.count} {preview.count === 1 ? 'person' : 'people'} right now
              </span>
            )}
          </div>

          {editing.rules.rules.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={r.type} onChange={(e) => changeType(i, e.target.value)} style={{ width: 190 }}>
                {Object.entries(RULE_DEFS).map(([k, d]) => (
                  <option key={k} value={k}>
                    {d.label}
                  </option>
                ))}
              </select>
              <select value={r.op} onChange={(e) => patchRule(i, { op: e.target.value })} style={{ width: 200 }}>
                {(RULE_DEFS[r.type]?.ops ?? []).map(([op, label]) => (
                  <option key={op} value={op}>
                    {label}
                  </option>
                ))}
              </select>
              {valueField(r, i)}
              {RULE_DEFS[r.type]?.value === 'tag' && (
                <datalist id={`tags-${i}`}>
                  {(opts?.tags ?? []).map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              )}
              <button className="th-btn th-btn--xs th-btn--danger" onClick={() => setRules({ ...editing.rules, rules: editing.rules.rules.filter((_, j) => j !== i) })} title="Remove rule">
                ×
              </button>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="th-btn th-btn--xs" onClick={() => setRules({ ...editing.rules, rules: [...editing.rules.rules, newRule()] })}>
              + Add rule
            </button>
            <span style={{ flex: 1 }} />
            <button className="th-btn" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </button>
            <button className="th-btn th-btn-primary" onClick={() => void save()} disabled={busy || !editing.name.trim()}>
              {editing.id ? 'Save segment' : 'Create segment'}
            </button>
          </div>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Segment</th>
            <th>Rules</th>
            <th style={{ textAlign: 'right' }}>People now</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No segments yet.
              </td>
            </tr>
          )}
          {rows.map((s) => (
            <tr key={s.id}>
              <td style={{ fontWeight: 600 }}>{s.name}</td>
              <td className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>
                {(s.rules?.rules ?? []).length} {(s.rules?.rules ?? []).length === 1 ? 'rule' : 'rules'} · match {s.rules?.match ?? 'all'}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{s.count}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button className="th-btn th-btn--xs" onClick={() => start(s)} disabled={busy || !!editing}>
                  Edit
                </button>{' '}
                <button className="th-btn th-btn--xs th-btn--danger" onClick={() => void remove(s)} disabled={busy}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
