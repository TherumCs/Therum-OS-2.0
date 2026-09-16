'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BASE_PATH } from '../../../../../lib/session';
import { MediaPicker } from '../../../MediaPicker';
import { api } from '../../MarketingClient';
import { SendPanel } from './SendPanel';
import { TriggerPanel, type Trigger } from '../../automations/[id]/TriggerPanel';

// The composer.
//
// Blocks are the source of truth; the right-hand pane is the REAL render from
// the backend (the same kit every receipt uses), refreshed as you type. Every
// block can show the HTML it generated — edit it and that HTML becomes the
// block (`custom`); "Reset" hands control back to the fields. "Source" shows
// the whole email as it will be sent, merge tags and all.

export type Block = {
  id: string;
  type: 'eyebrow' | 'heading' | 'text' | 'image' | 'button' | 'divider' | 'spacer' | 'product' | 'html';
  text?: string;
  html?: string;
  align?: 'center' | 'left';
  src?: string;
  alt?: string;
  href?: string;
  full?: boolean;
  label?: string;
  url?: string;
  height?: number;
  slug?: string;
  custom?: string;
};

export interface CampaignFull {
  id: string;
  name: string;
  channel: string;
  subject: string;
  preheader: string;
  fromName: string | null;
  replyTo: string | null;
  blocks: Block[];
  html: string;
  text: string;
  audience?: Record<string, unknown>;
  status?: string;
  key?: string;
  enabled?: boolean;
  trigger?: Trigger;
  scheduledAt: string | null;
  sentAt: string | null;
  recipientCount: number;
  sentCount: number;
  openCount: number;
  clickCount: number;
}

interface Preview {
  html: string;
  raw: string;
  blocks: Record<string, string>;
  text: string;
}

const TYPE_LABEL: Record<Block['type'], string> = {
  eyebrow: 'Eyebrow',
  heading: 'Heading',
  text: 'Text',
  image: 'Image',
  button: 'Button',
  divider: 'Divider',
  spacer: 'Spacer',
  product: 'Product',
  html: 'HTML',
};

const newId = () => Math.random().toString(36).slice(2, 10);

const blank = (type: Block['type']): Block => {
  const b: Block = { id: newId(), type };
  if (type === 'eyebrow') b.text = 'New drop';
  if (type === 'heading') b.text = 'Headline';
  if (type === 'text') b.html = 'Write something worth reading.';
  if (type === 'button') {
    b.label = 'Shop now';
    b.url = '/shop';
  }
  if (type === 'spacer') b.height = 24;
  if (type === 'image') b.src = '';
  if (type === 'product') b.slug = '';
  if (type === 'html') b.html = '<p style="text-align:center;">Your HTML here</p>';
  return b;
};

export function CampaignEditor({ initial, kind = 'campaign' }: { initial: CampaignFull; kind?: 'campaign' | 'automation' }) {
  const base = kind === 'automation' ? 'automations' : 'campaigns';
  const [status, setStatus] = useState(initial.status ?? 'draft');
  const locked = kind === 'campaign' && (status === 'sending' || status === 'sent' || status === 'scheduled' || status === 'paused');
  const isSms = initial.channel === 'sms';
  const [smsText, setSmsText] = useState(initial.text || '');
  const [meta, setMeta] = useState({ name: initial.name, subject: initial.subject, preheader: initial.preheader, fromName: initial.fromName || '', replyTo: initial.replyTo || '' });
  const [blocks, setBlocks] = useState<Block[]>(Array.isArray(initial.blocks) ? initial.blocks : []);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [pane, setPane] = useState<'preview' | 'source' | 'text'>('preview');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [openHtml, setOpenHtml] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [testTo, setTestTo] = useState('');
  const [picker, setPicker] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [productQ, setProductQ] = useState<Record<string, string>>({});
  const [productHits, setProductHits] = useState<Record<string, { name: string; slug: string; image: string | null; price: number | null }[]>>({});

  // ── Live preview (debounced) ──
  const timer = useRef<number | null>(null);
  const refresh = useCallback(
    (bs: Block[], preheader: string) => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(async () => {
        setPreviewing(true);
        try {
          setPreview((await api.send('POST', `${base}/${initial.id}/preview`, { blocks: bs, preheader })) as Preview);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Preview failed.');
        }
        setPreviewing(false);
      }, 350);
    },
    [initial.id],
  );
  useEffect(() => {
    refresh(blocks, meta.preheader);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (next: Block[]) => {
    setBlocks(next);
    setDirty(true);
    refresh(next, meta.preheader);
  };
  const patchBlock = (id: string, p: Partial<Block>) => update(blocks.map((b) => (b.id === id ? { ...b, ...p } : b)));
  const removeBlock = (id: string) => update(blocks.filter((b) => b.id !== id));
  const move = (id: string, dir: -1 | 1) => {
    const i = blocks.findIndex((b) => b.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= blocks.length) return;
    const next = blocks.slice();
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };
  const addBlock = (type: Block['type'], afterId?: string) => {
    const b = blank(type);
    if (!afterId) return update([...blocks, b]);
    const i = blocks.findIndex((x) => x.id === afterId);
    update([...blocks.slice(0, i + 1), b, ...blocks.slice(i + 1)]);
  };
  const dropOn = (targetId: string) => {
    if (!drag || drag === targetId) return;
    const from = blocks.findIndex((b) => b.id === drag);
    const to = blocks.findIndex((b) => b.id === targetId);
    const next = blocks.slice();
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    update(next);
    setDrag(null);
    setOver(null);
  };

  // ── Save / test ──
  const save = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await api.send('PATCH', `${base}/${initial.id}`, isSms
        ? { name: meta.name, text: smsText }
        : {
            name: meta.name,
            subject: meta.subject,
            preheader: meta.preheader,
            fromName: meta.fromName || null,
            replyTo: meta.replyTo || null,
            blocks,
          });
      setDirty(false);
      setSavedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
    setSaving(false);
  };

  const sendTest = async () => {
    if (!isSms && !testTo.includes('@')) return;
    if (isSms && testTo.replace(/\D/g, '').length < 8) return;
    setError('');
    setNotice('');
    try {
      if (dirty) await save();
      const r = (await api.send('POST', `${base}/${initial.id}/test`, { to: testTo })) as { to: string; subject: string };
      setNotice(`Test sent to ${r.to} — subject “${r.subject}”. Check the inbox (and spam) before trusting it.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test send failed.');
    }
  };

  const searchProducts = async (id: string, q: string) => {
    setProductQ((m) => ({ ...m, [id]: q }));
    try {
      const hits = (await api.get(`products?q=${encodeURIComponent(q)}`)) as { name: string; slug: string; image: string | null; price: number | null }[];
      setProductHits((m) => ({ ...m, [id]: hits }));
    } catch {
      /* picker is best-effort */
    }
  };

  const setMetaField = (k: keyof typeof meta, v: string) => {
    const next = { ...meta, [k]: v };
    setMeta(next);
    setDirty(true);
    if (k === 'preheader') refresh(blocks, v);
  };

  const srcDoc = useMemo(() => preview?.html ?? '<p style="font-family:sans-serif;color:#888;padding:40px;text-align:center">Rendering…</p>', [preview]);

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <a href={`${BASE_PATH}/marketing`} className="th-hint">
          ← Marketing
        </a>
        {kind === 'campaign' ? (
          <span className={'pill' + (status === 'sent' ? ' pill-ok' : status === 'draft' ? '' : ' pill-pending')}>{status}</span>
        ) : (
          <span className="pill">automation</span>
        )}
        <span style={{ flex: 1 }} />
        {savedAt && !dirty && <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>Saved {savedAt.toLocaleTimeString()}</span>}
        {dirty && <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>Unsaved changes</span>}
        <input placeholder={isSms ? '+1 215 555 0100' : 'you@example.com'} value={testTo} onChange={(e) => setTestTo(e.target.value)} style={{ width: 220 }} />
        <button className="th-btn" onClick={() => void sendTest()} disabled={saving || (isSms ? testTo.replace(/\D/g, '').length < 8 : !testTo.includes('@'))}>
          Send test
        </button>
        <button className="th-btn th-btn-primary" onClick={() => void save()} disabled={saving || locked || !dirty}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {locked && (
        <div className="notice">
          {status === 'sent' ? 'This campaign has gone out and is read-only. Duplicate it from the Campaigns list to send it again.' : 'Content is locked while a send is scheduled or running. Cancel the schedule to edit.'}
        </div>
      )}
      {error && <div style={{ color: 'var(--th-danger-text)', fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      {isSms ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 520px) minmax(300px, 420px)', gap: 'var(--th-space-16)', alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 12 }}>
            <div className="th-card" style={{ padding: 14, display: 'grid', gap: 8 }}>
              <input value={meta.name} onChange={(e) => setMetaField('name', e.target.value)} placeholder="Text name (internal)" style={{ fontWeight: 600 }} disabled={locked} />
              <textarea
                rows={6}
                value={smsText}
                onChange={(e) => {
                  setSmsText(e.target.value);
                  setDirty(true);
                }}
                placeholder="Short. One link at most. {{first_name}} works here too."
                disabled={locked}
              />
              <div className="muted" style={{ fontSize: 'var(--th-fs-2xs)', display: 'flex', gap: 10 }}>
                <span>{smsText.length} characters</span>
                <span>· {Math.max(1, Math.ceil((smsText.length + 22) / (/[^\x00-\x7F]/.test(smsText) ? 70 : 160)))} segment(s) incl. the opt-out line</span>
                <span>· goes only to people who ticked SMS consent</span>
              </div>
            </div>
            {kind === 'campaign' && (
              <SendPanel campaignId={initial.id} status={status} initialAudience={(initial.audience ?? {}) as { all?: boolean; listIds?: string[]; excludeListIds?: string[]; segmentIds?: string[] }} dirty={dirty} onSaveFirst={save} onStatus={setStatus} />
            )}
          </div>
          <div style={{ position: 'sticky', top: 12 }}>
            <div className="th-card-label" style={{ marginBottom: 6 }}>Preview</div>
            <div style={{ background: '#111', borderRadius: 28, padding: '38px 14px', width: 300, margin: '0 auto' }}>
              <div style={{ background: '#fff', borderRadius: 18, minHeight: 300, padding: 14 }}>
                <div style={{ fontSize: 11, color: '#8a8a8a', textAlign: 'center', marginBottom: 12 }}>Text message · today</div>
                <div style={{ background: '#e9e9eb', color: '#0a0a0a', borderRadius: 16, padding: '10px 12px', fontSize: 14, lineHeight: 1.45, maxWidth: 230, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {(smsText || 'Your message…').replace(/\{\{\s*first_name\s*\}\}/g, 'Bam')}
                  {smsText && !/\bSTOP\b/i.test(smsText) ? '\nReply STOP to opt out' : ''}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 520px) minmax(360px, 1fr)', gap: 'var(--th-space-16)', alignItems: 'start' }}>
        {/* ── Left: meta + blocks ── */}
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="th-card" style={{ padding: 14, display: 'grid', gap: 8 }}>
            <input value={meta.name} onChange={(e) => setMetaField('name', e.target.value)} placeholder="Campaign name (internal)" style={{ fontWeight: 600 }} disabled={locked} />
            <input value={meta.subject} onChange={(e) => setMetaField('subject', e.target.value)} placeholder="Subject line" disabled={locked} />
            <input value={meta.preheader} onChange={(e) => setMetaField('preheader', e.target.value)} placeholder="Preheader (the grey line after the subject in the inbox)" disabled={locked} />
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={meta.fromName} onChange={(e) => setMetaField('fromName', e.target.value)} placeholder="From name (optional)" disabled={locked} />
              <input value={meta.replyTo} onChange={(e) => setMetaField('replyTo', e.target.value)} placeholder="Reply-to (optional)" disabled={locked} />
            </div>
            <div className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>
              Merge tags: <code>{'{{first_name}}'}</code> <code>{'{{email}}'}</code> <code>{'{{unsubscribe_url}}'}</code>
              {kind === 'automation' && (
                <>
                  {' '}<code>{'{{coupon_code}}'}</code> <code>{'{{coupon_expires}}'}</code> <code>{'{{cart_url}}'}</code> <code>{'{{product_name}}'}</code> <code>{'{{product_url}}'}</code>
                </>
              )}{' '}
              — work in any text.
            </div>
          </div>

          {kind === 'campaign' ? (
            <SendPanel campaignId={initial.id} status={status} initialAudience={(initial.audience ?? {}) as { all?: boolean; listIds?: string[]; excludeListIds?: string[]; segmentIds?: string[] }} dirty={dirty} onSaveFirst={save} onStatus={setStatus} />
          ) : (
            <TriggerPanel automationId={initial.id} automationKey={initial.key ?? ''} initialEnabled={!!initial.enabled} initialTrigger={initial.trigger ?? {}} dirty={dirty} onSaveFirst={save} />
          )}

          {blocks.map((b, i) => {
            const showHtml = !!openHtml[b.id];
            const generated = preview?.blocks[b.id] ?? '';
            return (
              <div
                key={b.id}
                className="th-card"
                draggable={!locked}
                onDragStart={() => setDrag(b.id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (over !== b.id) setOver(b.id);
                }}
                onDragLeave={() => setOver((o) => (o === b.id ? null : o))}
                onDrop={() => dropOn(b.id)}
                onDragEnd={() => {
                  setDrag(null);
                  setOver(null);
                }}
                style={{ padding: 12, display: 'grid', gap: 8, outline: over === b.id && drag !== b.id ? '2px dashed var(--th-accent, #e83b3b)' : undefined, opacity: drag === b.id ? 0.5 : 1 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span title="Drag to reorder" style={{ cursor: locked ? 'default' : 'grab', color: 'var(--th-muted)', userSelect: 'none' }}>
                    ⋮⋮
                  </span>
                  <span className="th-card-label">
                    {i + 1} · {TYPE_LABEL[b.type]}
                    {b.custom ? ' · custom HTML' : ''}
                  </span>
                  <span style={{ flex: 1 }} />
                  <button className="th-btn th-btn--xs" onClick={() => setOpenHtml((m) => ({ ...m, [b.id]: !showHtml }))} title="Show this block's HTML">
                    {showHtml ? 'Hide HTML' : 'HTML'}
                  </button>
                  <button className="th-btn th-btn--xs" onClick={() => move(b.id, -1)} disabled={locked || i === 0} title="Move up">
                    ↑
                  </button>
                  <button className="th-btn th-btn--xs" onClick={() => move(b.id, 1)} disabled={locked || i === blocks.length - 1} title="Move down">
                    ↓
                  </button>
                  <button className="th-btn th-btn--xs th-btn--danger" onClick={() => removeBlock(b.id)} disabled={locked} title="Remove block">
                    ×
                  </button>
                </div>

                {!b.custom && (
                  <>
                    {(b.type === 'eyebrow' || b.type === 'heading') && (
                      <input value={b.text || ''} onChange={(e) => patchBlock(b.id, { text: e.target.value })} placeholder={TYPE_LABEL[b.type]} disabled={locked} />
                    )}
                    {b.type === 'text' && (
                      <>
                        <textarea rows={4} value={b.html || ''} onChange={(e) => patchBlock(b.id, { html: e.target.value })} placeholder="Copy. Basic HTML is fine: <b>, <a href>, <br>." disabled={locked} />
                        <label style={{ fontSize: 'var(--th-fs-2xs)', display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input type="checkbox" checked={b.align === 'left'} onChange={(e) => patchBlock(b.id, { align: e.target.checked ? 'left' : 'center' })} disabled={locked} /> Left-align
                        </label>
                      </>
                    )}
                    {b.type === 'image' && (
                      <>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input value={b.src || ''} onChange={(e) => patchBlock(b.id, { src: e.target.value })} placeholder="Image URL (/api/uploads/… or https://…)" disabled={locked} />
                          <button className="th-btn th-btn--xs" onClick={() => setPicker(b.id)} disabled={locked}>
                            Library
                          </button>
                        </div>
                        {b.src && <img src={b.src} alt="" style={{ maxHeight: 120, objectFit: 'contain', justifySelf: 'start', borderRadius: 6, background: 'var(--th-bg)' }} />}
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input value={b.alt || ''} onChange={(e) => patchBlock(b.id, { alt: e.target.value })} placeholder="Alt text" disabled={locked} />
                          <input value={b.href || ''} onChange={(e) => patchBlock(b.id, { href: e.target.value })} placeholder="Link (optional)" disabled={locked} />
                        </div>
                        <label style={{ fontSize: 'var(--th-fs-2xs)', display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input type="checkbox" checked={!!b.full} onChange={(e) => patchBlock(b.id, { full: e.target.checked })} disabled={locked} /> Edge to edge
                        </label>
                      </>
                    )}
                    {b.type === 'button' && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input value={b.label || ''} onChange={(e) => patchBlock(b.id, { label: e.target.value })} placeholder="Label" disabled={locked} />
                        <input value={b.url || ''} onChange={(e) => patchBlock(b.id, { url: e.target.value })} placeholder="URL" disabled={locked} />
                      </div>
                    )}
                    {b.type === 'spacer' && (
                      <label style={{ fontSize: 'var(--th-fs-2xs)', display: 'flex', gap: 8, alignItems: 'center' }}>
                        Height <input type="number" min={4} max={120} value={b.height ?? 24} onChange={(e) => patchBlock(b.id, { height: Number(e.target.value) })} style={{ width: 80 }} disabled={locked} /> px
                      </label>
                    )}
                    {b.type === 'product' && (
                      <>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input value={b.slug || ''} onChange={(e) => patchBlock(b.id, { slug: e.target.value })} placeholder="Product slug" disabled={locked} />
                          <input value={b.label || ''} onChange={(e) => patchBlock(b.id, { label: e.target.value })} placeholder="Button label (Shop it)" style={{ width: 160 }} disabled={locked} />
                        </div>
                        <input value={productQ[b.id] ?? ''} onChange={(e) => void searchProducts(b.id, e.target.value)} placeholder="Search products…" disabled={locked} />
                        {(productHits[b.id] ?? []).length > 0 && (
                          <div style={{ display: 'grid', gap: 4, maxHeight: 180, overflow: 'auto' }}>
                            {(productHits[b.id] ?? []).map((p) => (
                              <button
                                key={p.slug}
                                className="th-btn th-btn--xs"
                                style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                                onClick={() => {
                                  patchBlock(b.id, { slug: p.slug });
                                  setProductHits((m) => ({ ...m, [b.id]: [] }));
                                }}
                              >
                                {p.name} <span className="muted">· {p.slug}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    {b.type === 'html' && (
                      <textarea rows={6} value={b.html || ''} onChange={(e) => patchBlock(b.id, { html: e.target.value })} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }} disabled={locked} />
                    )}
                  </>
                )}

                {showHtml && (
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="th-card-label">{b.custom ? 'Custom HTML (this is what sends)' : 'Generated HTML — edit to take over'}</span>
                      <span style={{ flex: 1 }} />
                      {b.custom && (
                        <button className="th-btn th-btn--xs" onClick={() => patchBlock(b.id, { custom: undefined })} disabled={locked}>
                          Reset to generated
                        </button>
                      )}
                    </div>
                    <textarea
                      rows={8}
                      value={b.custom ?? generated}
                      onChange={(e) => patchBlock(b.id, { custom: e.target.value })}
                      style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, lineHeight: 1.45 }}
                      spellCheck={false}
                      disabled={locked}
                    />
                  </div>
                )}

                {!locked && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(Object.keys(TYPE_LABEL) as Block['type'][]).map((t) => (
                      <button key={t} className="th-btn th-btn--xs" onClick={() => addBlock(t, b.id)} style={{ opacity: 0.8 }}>
                        + {TYPE_LABEL[t]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {blocks.length === 0 && !locked && (
            <div className="th-card" style={{ padding: 14 }}>
              <div className="th-card-label">Add the first block</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
                {(Object.keys(TYPE_LABEL) as Block['type'][]).map((t) => (
                  <button key={t} className="th-btn th-btn--xs" onClick={() => addBlock(t)}>
                    + {TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right: the real render ── */}
        <div style={{ position: 'sticky', top: 12, display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div className="th-tabs" role="tablist" style={{ margin: 0 }}>
              {(['preview', 'source', 'text'] as const).map((p) => (
                <button key={p} role="tab" aria-selected={pane === p} className={'th-tab' + (pane === p ? ' on' : '')} onClick={() => setPane(p)}>
                  {p === 'preview' ? 'Preview' : p === 'source' ? 'Source' : 'Plain text'}
                </button>
              ))}
            </div>
            <span style={{ flex: 1 }} />
            {pane === 'preview' && (
              <>
                <button className={'th-btn th-btn--xs' + (device === 'desktop' ? ' th-btn-primary' : '')} onClick={() => setDevice('desktop')}>
                  Desktop
                </button>
                <button className={'th-btn th-btn--xs' + (device === 'mobile' ? ' th-btn-primary' : '')} onClick={() => setDevice('mobile')}>
                  Phone
                </button>
              </>
            )}
            {pane === 'source' && preview && (
              <button className="th-btn th-btn--xs" onClick={() => void navigator.clipboard.writeText(preview.raw)}>
                Copy HTML
              </button>
            )}
            {previewing && <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>Rendering…</span>}
          </div>

          {pane === 'preview' && (
            <div style={{ background: '#fafafa', border: '1px solid var(--th-border, #e7e7e7)', borderRadius: 12, padding: 8, display: 'flex', justifyContent: 'center' }}>
              <iframe title="Email preview" srcDoc={srcDoc} sandbox="" style={{ width: device === 'mobile' ? 390 : '100%', maxWidth: '100%', height: 'calc(100vh - 160px)', border: 0, background: '#fafafa', borderRadius: 8 }} />
            </div>
          )}
          {pane === 'source' && (
            <textarea readOnly value={preview?.raw ?? ''} rows={30} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, lineHeight: 1.45, width: '100%', height: 'calc(100vh - 160px)' }} spellCheck={false} />
          )}
          {pane === 'text' && (
            <textarea readOnly value={preview?.text ?? ''} rows={30} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.5, width: '100%', height: 'calc(100vh - 160px)' }} spellCheck={false} />
          )}
        </div>
      </div>

      )}

      <MediaPicker
        open={picker !== null}
        kind="image"
        onClose={() => setPicker(null)}
        onPick={(asset) => {
          if (picker) patchBlock(picker, { src: asset.url, alt: asset.alt || '' });
          setPicker(null);
        }}
      />
    </section>
  );
}
