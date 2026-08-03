'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../../lib/session';
import { MediaPicker } from '../../MediaPicker';
import type { EditorProduct } from './ProductEditor';

// The product editor, as three columns.
//
// LEFT is what the product IS — its images, its variants, its filing. A list
// of things you can select.
// CENTRE is what the customer will SEE. Not a form: the actual card and the
// actual product page, redrawn as you type, because every card setting in
// Customization changes how this product reads and a form cannot show you that.
// RIGHT is whatever you selected on the left. Pick a variant and you get price,
// SKU and stock; pick an image and you get its alt text.
//
// The reason to build it this way rather than as one long form: a product has
// three different KINDS of thing to edit, and a single column forces you to
// scroll past two of them to reach the third. Selecting on the left and editing
// on the right keeps the thing you are changing and the result of changing it
// on screen together.

interface Term { id: string; name: string; slug: string }

/** Enter commits, Escape reverts. Blur alone means typing then looking at the
 *  screen produces nothing, which reads exactly like a broken editor. */
function commitKeys(e: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void {
  if (e.key === 'Enter' && !(e.target as HTMLElement).matches('textarea')) {
    e.preventDefault();
    (e.target as HTMLInputElement).blur();
  }
  if (e.key === 'Escape') {
    const el = e.target as HTMLInputElement;
    el.value = el.defaultValue;
    el.blur();
  }
}

type Selection =
  | { kind: 'product' }
  | { kind: 'variant'; id: string }
  | { kind: 'image'; index: number };

const money = (minor: number): string => `$${(minor / 100).toFixed(2)}`;

/**
 * The colour chip shown when a variant has no photo. Same rule the storefront
 * uses: one code is solid, two are a hard split — never a blend, because a
 * gradient between the two invents a colour that is on neither.
 */
function swatchStyle(codes?: string[]): React.CSSProperties {
  const safe = (codes ?? []).filter((c) => /^#[0-9a-f]{3,8}$/i.test(c));
  if (!safe.length) return {};
  if (safe.length === 1) return { background: safe[0] };
  return { background: `linear-gradient(135deg, ${safe[0]} 0 50%, ${safe[1]} 50% 100%)` };
}

export function ProductStudio({
  initial,
  allCategories,
  allTags,
  allMilieus = [],
}: {
  initial: EditorProduct;
  allCategories: Term[];
  allTags: Term[];
  /** Groups a restricted product can be opened to. */
  allMilieus?: { id: string; name: string }[];
}) {
  // Current grants come from the product itself, so the panel opens showing
  // who actually has access rather than an empty box.
  const initialMilieuIds = (initial.audiences ?? []).map((a) => a.milieuId);
  const initialEmails = (initial.access ?? []).map((a) => a.customer.email);
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [sel, setSel] = useState<Selection>({ kind: 'product' });
  const [preview, setPreview] = useState<'card' | 'page'>('card');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  // Which field last saved, so the confirmation appears NEXT TO the thing that
  // changed rather than only in the header where nobody is looking.
  const [savedField, setSavedField] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<null | 'primary' | 'gallery' | { variantId: string }>(null);
  // Terms live in state, not straight off the props: a category created here
  // has to appear in the chip row immediately, without a page reload.
  const [cats, setCats] = useState<Term[]>(allCategories);
  const [tags, setTags] = useState<Term[]>(allTags);
  // Forms stay behind a button so the panel is a list of what IS set, not a
  // wall of empty inputs.
  const [adding, setAdding] = useState<'' | 'category' | 'tag' | 'variant'>('');
  // Store-wide look settings, edited here because this is where you can SEE
  // them. They are NOT per-product, and the panel says so — a control that
  // silently restyles the whole catalogue is worse than no control.
  const [look, setLook] = useState<Record<string, string>>({});
  const [lookLoaded, setLookLoaded] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  /**
   * The frame renders at DESKTOP width and is scaled to fit the column.
   *
   * Left to the column's own width the iframe is ~300px, so the storefront
   * serves its mobile layout — a preview of a layout you were not editing.
   * Rendering at 1280 and scaling down shows the real desktop composition.
   */
  const FRAME_W = 1280;
  // A single card only needs a card's worth of width.
  const CARD_FRAME_W = 430;
  const frameBox = useRef<HTMLDivElement | null>(null);
  const [frameScale, setFrameScale] = useState(0.3);
  const [cardScale, setCardScale] = useState(1);
  // The card frame sizes ITSELF to the card. A fixed height either clips the
  // card or leaves it swimming in empty box, and neither is a preview.
  const [cardH, setCardH] = useState(560);
  const cardFrame = useRef<HTMLIFrameElement | null>(null);
  /**
   * Size the card frame to the card.
   *
   * Measured from the PARENT rather than the iframe's load event: a cached
   * frame fires load before React attaches the handler, and the height then
   * stays at its initial guess forever — which is exactly what happened. This
   * polls briefly instead, so it cannot miss the event, and stops as soon as
   * the height settles.
   */
  useEffect(() => {
    if (preview !== 'card') return;
    let last = 0, stable = 0;
    const tick = window.setInterval(() => {
      const body = cardFrame.current?.contentDocument?.body;
      if (!body) return;
      const h = Math.ceil(body.scrollHeight) + 4;
      if (h === last) { if (++stable > 3) window.clearInterval(tick); return; }
      last = h; stable = 0; setCardH(h);
    }, 250);
    const stop = window.setTimeout(() => window.clearInterval(tick), 6000);
    return () => { window.clearInterval(tick); window.clearTimeout(stop); };
  }, [preview, frameKey]);
  useEffect(() => {
    const el = frameBox.current;
    if (!el) return;
    // The parent, not the frame itself: the frame CONTAINS the 1280px child,
    // so measuring it is circular and reports the child's width — which is why
    // the preview rendered at full size and spilled across the admin.
    // The iframe is positioned OUT OF FLOW, so the frame's own width is now a
    // true measure of the space available rather than a reflection of its
    // 1280px child. Measuring the child's container while the child defines it
    // is what pinned the scale at half the column.
    const fit = () => {
      const w = el.clientWidth || FRAME_W;
      setFrameScale(Math.min(1, w / FRAME_W));
      // Kept for the page frame only; the card renders at natural size.
      setCardScale(1);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [preview]);
  const [milieuIds, setMilieuIds] = useState<string[]>(initialMilieuIds);
  const [emails, setEmails] = useState<string[]>(initialEmails);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [termName, setTermName] = useState('');

  /**
   * Create a category or tag and put it straight on this product.
   *
   * A name that already exists comes back 409 rather than creating a second
   * one — in that case the existing term is selected instead, because a
   * merchant typing a name that is already there means "use that one", not
   * "fail". Slug is derived here so the box can stay a single field.
   */
  async function addTerm(kind: 'category' | 'tag') {
    const name = termName.trim();
    if (!name) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const list = kind === 'category' ? cats : tags;
    const existing = list.find((t) => t.slug === slug || t.name.toLowerCase() === name.toLowerCase());
    const term = existing ?? (await call('POST', kind === 'category' ? '/api/catalog/categories' : '/api/catalog/tags', { name, slug }) as Term | null);
    if (!term) return;
    if (!existing) (kind === 'category' ? setCats : setTags)([...list, term]);

    const nextCats = kind === 'category' && !p.categories.some((x) => x.id === term.id) ? [...p.categories, term] : p.categories;
    const nextTags = kind === 'tag' && !p.tags.some((x) => x.id === term.id) ? [...p.tags, term] : p.tags;
    setP({ ...p, categories: nextCats, tags: nextTags });
    await call('PUT', `/api/products/${p.id}/taxonomy`, { categoryIds: nextCats.map((x) => x.id), tagIds: nextTags.map((x) => x.id) });
    setTermName('');
    setAdding('');
  }
  const [newVariant, setNewVariant] = useState({ sku: '', price: '', color: '', size: '', inventory: '0', stockStatus: 'in_stock' });

  useEffect(() => {
    void fetch(`${BASE_PATH}/api/settings/counter`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c: Record<string, string> | null) => { if (c) setLook(c); setLookLoaded(true); })
      .catch(() => setLookLoaded(true));
  }, []);

  async function saveLook(patch: Record<string, string>): Promise<void> {
    setLook({ ...look, ...patch });
    await fetch(`${BASE_PATH}/api/settings/counter`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
    }).catch(() => {});
    // The frame renders the REAL page, so it is refetched to show the change
    // rather than re-styled in place.
    setFrameKey((k) => k + 1);
  }

  const lookBool = (label: string, key: string) => (
    <label className="th-look__field" key={key}>
      <span>{label}</span>
      <select
        value={String(look[key] ?? 'false')}
        disabled={!lookLoaded}
        onChange={(e) => void saveLook({ [key]: e.target.value === 'true' } as unknown as Record<string, string>)}
      >
        <option value="true">On</option>
        <option value="false">Off</option>
      </select>
    </label>
  );

  const lookRow = (label: string, key: string, options: [string, string][]) => (
    <label className="th-look__field" key={key}>
      <span>{label}</span>
      <select value={look[key] ?? options[0]?.[0] ?? ''} disabled={!lookLoaded} onChange={(e) => void saveLook({ [key]: e.target.value })}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch(`${BASE_PATH}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError((json as { error?: { message?: string } } | null)?.error?.message ?? `Request failed (${res.status})`);
        return null;
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
      router.refresh();
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  const patch = (body: Record<string, unknown>): Promise<unknown> => call('PATCH', `/api/products/${p.id}`, body);

  const lowest = useMemo(
    () => (p.variants.length ? Math.min(...p.variants.map((v) => v.price)) : 0),
    [p.variants],
  );
  const selectedVariant = sel.kind === 'variant' ? p.variants.find((v) => v.id === sel.id) ?? null : null;
  const gallery = p.images ?? [];

  // ── LEFT ────────────────────────────────────────────────────────────
  const left = (
    <div className="th-studio__rail">
      <button
        type="button"
        className={'th-studio__item' + (sel.kind === 'product' ? ' is-sel' : '')}
        onClick={() => setSel({ kind: 'product' })}
      >
        <strong>{p.name || 'Untitled product'}</strong>
        <span className="th-hint">Details, description, filing</span>
      </button>

      <div className="th-studio__group">
        <div className="th-studio__group-head">
          <span>Media</span>
          <button type="button" className="th-btn th-btn--xs" onClick={() => setPickerFor('gallery')}>Add</button>
        </div>
        {p.image && (
          <button
            type="button"
            className={'th-studio__thumbrow' + (sel.kind === 'image' && sel.index === -1 ? ' is-sel' : '')}
            onClick={() => setSel({ kind: 'image', index: -1 })}
          >
            <img src={p.image} alt="" />
            <span>Primary</span>
          </button>
        )}
        {gallery.map((g, i) => (
          <button
            key={`${g.url}-${i}`}
            type="button"
            className={'th-studio__thumbrow' + (sel.kind === 'image' && sel.index === i ? ' is-sel' : '')}
            onClick={() => setSel({ kind: 'image', index: i })}
          >
            <img src={g.url} alt="" />
            <span>{g.type === 'video' ? 'Video' : `Image ${i + 1}`}</span>
          </button>
        ))}
        {!p.image && !gallery.length && <p className="th-hint th-studio__empty">No media yet.</p>}
      </div>

      {/* Only VARIABLE products show a variants list. A product with one
          variant is a SIMPLE product — that single variant is the product
          itself, priced and stocked on the product panel — so a lone "Variant"
          row here would be counting the primary product as its own variant,
          which is exactly the thing not to do. */}
      {p.variants.length > 1 && (
      <div className="th-studio__group">
        <div className="th-studio__group-head"><span>Variants ({p.variants.length})</span></div>
        {p.variants.map((v) => (
          <button
            key={v.id}
            type="button"
            className={'th-studio__item th-studio__item--row' + (sel.kind === 'variant' && sel.id === v.id ? ' is-sel' : '')}
            onClick={() => setSel({ kind: 'variant', id: v.id })}
          >
            {/* The variant's OWN photo. The backend showed only the product
                image, so every colourway looked identical here while the
                storefront showed them correctly — which reads as the sync
                being broken rather than the editor not displaying it. */}
            {v.image
              ? <img className="th-studio__vthumb" src={v.image} alt="" loading="lazy" />
              : <span className="th-studio__vthumb th-studio__vthumb--none" style={swatchStyle(v.colorCodes)} />}
            <span>{[v.color, v.size].filter(Boolean).join(' / ') || v.sku || 'Variant'}</span>
            <span className="th-hint">{money(v.price)}</span>
          </button>
        ))}
      </div>
      )}
    </div>
  );

  // ── CENTRE ──────────────────────────────────────────────────────────
  const centre = (
    <div className="th-studio__stage">
      <div className="th-studio__stagebar">
        <div className="th-tabs" role="tablist" aria-label="Preview">
          {(['card', 'page'] as const).map((mode) => (
            <button
              key={mode}
              role="tab"
              aria-selected={preview === mode}
              className={'th-tab' + (preview === mode ? ' on' : '')}
              onClick={() => setPreview(mode)}
            >
              {mode === 'card' ? 'Card' : 'Product page'}
            </button>
          ))}
        </div>
        <a className="th-hint" href={`/product/${p.slug}`} target="_blank" rel="noreferrer">Open live ↗</a>
      </div>

      <div className="th-studio__canvas">
        {preview === 'card' ? (
          /* The REAL card, built by the shop's own code path with the store's
             own settings. The hand-built mock could not honour the sixteen
             card settings, so it disagreed with the shop the moment any of
             them was touched. */
          <div className="th-pv-frame th-pv-frame--card" ref={frameBox} style={{ height: cardH }}>
            <iframe
              key={`card-${frameKey}`}
              ref={cardFrame}
              title="Card preview"
              src={`/shop?preview=card&q=${encodeURIComponent(p.name)}`}
              /* A CARD is small, so it renders at a narrow width and scales UP
                 to fill the column — the page frame keeps the desktop width
                 because a page has to be seen in its real proportions. */
              /* NO transform. A card at its natural width already fits this
                 column, and scaling it meant the frame's height and the
                 content's height were computed from two different numbers —
                 which clipped the bottom of the card by whatever they
                 disagreed by. Width 100%, height measured, nothing scaled. */
              style={{ width: '100%', height: cardH }}
            />
          </div>
        ) : (
          /* The REAL page, in a scrolling frame. A hand-built mock drifts from
             the storefront the moment either changes, and then it lies about
             the thing it exists to show. */
          <div className="th-pv-frame" ref={frameBox}>
            <iframe
              key={frameKey}
              title="Product page preview"
              src={`/product/${p.slug}`}
              loading="lazy"
              style={{ width: FRAME_W, height: 2200, transform: `scale(${frameScale})`, transformOrigin: '0 0' }}
            />
            <div style={{ height: Math.round(2200 * frameScale) }} aria-hidden="true" />
          </div>
        )}
      </div>

      {/* Look controls, under the thing they change. */}
      <div className="th-look">
        <div className="th-look__head">
          <span>{preview === 'card' ? 'Card style' : 'Product page style'}</span>
          <span className="th-hint">Applies to the whole store</span>
        </div>
        <div className="th-look__grid">
          {preview === 'card' ? (
            <>
              {lookRow('Layout', 'cardPreset', [['editorial', 'Editorial'], ['retail', 'Retail'], ['detailed', 'Detailed'], ['sneaker', 'Sneaker'], ['data', 'Data']])}
              {lookRow('Shell', 'cardShell', [['bare', 'Bare'], ['boxed', 'Boxed'], ['elevated', 'Elevated']])}
              {lookRow('Hover media', 'cardMedia', [['auto', 'Auto — follow the product'], ['still', 'Still'], ['fade', 'Fade'], ['gallery', 'Gallery arrows'], ['motion', 'Play video']])}
              {lookRow('Second image', 'cardMediaSecondary', [['still', 'Still'], ['auto', 'Auto'], ['fade', 'Fade'], ['gallery', 'Gallery arrows'], ['motion', 'Play video']])}
              {lookRow('Action', 'cardAction', [['none', 'None'], ['below', 'Below'], ['overlay', 'Overlay'], ['dual', 'Two buttons'], ['icons', 'Icons']])}
              {lookRow('Shape', 'cardRatio', [['square', 'Square'], ['portrait', 'Portrait'], ['tall', 'Tall'], ['landscape', 'Landscape'], ['natural', 'Natural']])}
              {lookRow('Image fit', 'cardFit', [['cover', 'Cover — fills, may crop'], ['contain', 'Contain — whole product']])}
              {lookRow('Corners', 'cardRadius', [['sharp', 'Sharp'], ['soft', 'Soft'], ['round', 'Round'], ['pill', 'Pill'], ['squircle', 'Squircle']])}
              {lookRow('Align', 'cardAlign', [['start', 'Left'], ['center', 'Centre'], ['end', 'Right']])}
              {lookRow('Shadow', 'cardShadow', [['none', 'None'], ['soft', 'Soft'], ['strong', 'Strong']])}
              {lookRow('Hover', 'cardHover', [['none', 'None'], ['lift', 'Lift'], ['zoom', 'Zoom'], ['both', 'Lift + zoom']])}
              {lookRow('Spacing', 'cardGap', [['tight', 'Tight'], ['normal', 'Normal'], ['roomy', 'Roomy']])}
              {lookRow('Reveal', 'cardReveal', [['none', 'None'], ['fade', 'Fade'], ['rise', 'Rise'], ['stagger', 'Stagger']])}
              {lookBool('Subtitle', 'cardSubtitle')}
              {lookBool('Badges', 'cardBadges')}
              {lookBool('In-card picker', 'cardEvolve')}
            </>
          ) : (
            <>
              {lookRow('Layout', 'pdpStyle', [['classic', 'Classic — gallery + details'], ['apple', 'Apple — centred'], ['athletic', 'Athletic — image grid'], ['editorial', 'Editorial — big type']])}
              {lookRow('Images on', 'pdpImageSide', [['left', 'Left'], ['right', 'Right']])}
              {lookRow('Thumbnails', 'pdpThumbs', [['bottom', 'Below the image'], ['side', 'Beside the image'], ['none', 'Hidden']])}
            </>
          )}
        </div>
      </div>

      <p className="th-hint th-studio__note">
        {preview === 'card'
          ? 'A preview, not the live page — card styling follows Customization, which this does not re-implement.'
          : 'The live product page, rendered in a frame. Scroll it like the real thing.'}
      </p>
    </div>
  );

  // ── RIGHT ───────────────────────────────────────────────────────────
  const inspector = (
    <div className="th-studio__rail th-studio__rail--right">
      {sel.kind === 'product' && (
        <>
          <div className="th-studio__group-head"><span>Product</span></div>
          <label className="th-studio__field">
            <span>Name</span>
            <input onKeyDown={commitKeys} defaultValue={p.name} onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== p.name) { setP({ ...p, name }); void patch({ name }); } }} />
          </label>
          <label className="th-studio__field">
            <span>Slug</span>
            <input onKeyDown={commitKeys} defaultValue={p.slug} onBlur={(e) => { const slug = e.target.value.trim(); if (slug && slug !== p.slug) { setP({ ...p, slug }); void patch({ slug }); } }} />
          </label>
          <label className="th-studio__field">
            <span>Status</span>
            <select value={p.status} onChange={(e) => { const status = e.target.value; setP({ ...p, status }); void patch({ status }); }}>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          {/* WHO may see it — a separate axis from Status. A product can be
              Active AND unlisted, so these are two controls, not one longer
              dropdown. */}
          <label className="th-studio__field">
            <span>Visibility</span>
            <select
              value={p.visibility ?? 'public'}
              onChange={(e) => { const visibility = e.target.value; setP({ ...p, visibility }); void patch({ visibility }); }}
            >
              <option value="public">Public — anyone</option>
              <option value="private">Unlisted — hidden, but the link works</option>
              <option value="restricted">Restricted — groups or accounts</option>
            </select>
          </label>
          {p.visibility === 'private' && (
            <p className="th-hint">Not in the shop, search or sitemap. Anyone you send the link to can open and buy it.</p>
          )}
          {p.visibility === 'restricted' && (
            <>
              <p className="th-hint">Everyone else gets a 404 — no hint it exists. A shopper needs ONE of the following.</p>
              <div className="th-studio__group-head"><span>Groups</span></div>
              <div className="th-studio__chips">
                {allMilieus.length === 0 && <span className="th-hint">No groups yet.</span>}
                {allMilieus.map((m) => {
                  const on = milieuIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={'th-pv-chip' + (on ? ' on' : '')}
                      disabled={busy}
                      onClick={() => {
                        const next = on ? milieuIds.filter((x) => x !== m.id) : [...milieuIds, m.id];
                        setMilieuIds(next);
                        void call('PUT', `/api/products/${p.id}/audience`, { milieuIds: next });
                      }}
                    >{m.name}</button>
                  );
                })}
              </div>
              <label className="th-studio__field">
                <span>Accounts</span>
                {/* One email per line, replaced wholesale on save — a partial
                    update would leave no way to REMOVE someone, which is the
                    operation that matters for something gated. */}
                <textarea
                  rows={3}
                  defaultValue={emails.join('\n')}
                  placeholder="one email per line"
                  onBlur={async (e) => {
                    const next = e.target.value.split(/\s*[\n,]\s*/).map((x) => x.trim()).filter(Boolean);
                    const res = (await call('PUT', `/api/products/${p.id}/audience`, { emails: next })) as
                      { emails?: string[]; unknownEmails?: string[] } | null;
                    if (res) {
                      setEmails(res.emails ?? []);
                      // Unknown addresses are SAID, not swallowed — otherwise
                      // the merchant believes someone has access who does not.
                      setUnknown(res.unknownEmails ?? []);
                    }
                  }}
                />
              </label>
              {unknown.length > 0 && (
                <p className="th-hint" style={{ color: 'var(--th-danger, #ef4444)' }}>
                  No account for: {unknown.join(', ')} — not granted.
                </p>
              )}
            </>
          )}

          <label className="th-studio__field">
            <span>Description</span>
            <textarea onKeyDown={commitKeys} rows={5} defaultValue={p.description ?? ''} onBlur={(e) => { const description = e.target.value; if (description !== (p.description ?? '')) { setP({ ...p, description }); void patch({ description }); } }} />
          </label>

          {/*
            PRICE, on the product panel.

            It already existed, but only inside the variant editor — so a new
            product showed $0.00 with no visible way to change it unless you
            knew to select the variant first. Price is the one field a product
            cannot ship without, so it belongs where the eye lands.

            One variant: edit it here directly, which is the common case.
            Several: show the range and say where to change them, rather than
            silently rewriting every variant to one number.
          */}
          <label className="th-studio__field">
            <span>Price{p.variants.length > 1 ? ' (range)' : ''}</span>
            {p.variants.length === 1 ? (
              <input
                type="number"
                step="0.01"
                min="0"
                onKeyDown={commitKeys}
                defaultValue={(p.variants[0]!.price / 100).toFixed(2)}
                onBlur={(e) => {
                  // Minor units. Entering 24.99 and storing 24 would be a
                  // hundredfold error that looks like a working save.
                  const price = Math.round(Number(e.target.value) * 100);
                  const only = p.variants[0]!;
                  if (!Number.isFinite(price) || price < 0 || price === only.price) return;
                  setP({ ...p, variants: [{ ...only, price }] });
                  void call('PATCH', `/api/products/${p.id}/variants/${only.id}`, { price });
                }}
              />
            ) : (
              <>
                <input
                  readOnly
                  value={
                    p.variants.length
                      ? (() => {
                          const lo = Math.min(...p.variants.map((v) => v.price));
                          const hi = Math.max(...p.variants.map((v) => v.price));
                          return lo === hi ? money(lo) : `${money(lo)} – ${money(hi)}`;
                        })()
                      : 'No variants yet'
                  }
                />
                <span className="th-hint">
                  {p.variants.length
                    ? 'Pick a variant on the left to change its price.'
                    : 'Add a variant below to set a price.'}
                </span>
              </>
            )}
          </label>

          {/* SKU and stock for a SIMPLE product — "what we have for the main
              product". The single base variant holds them; a variable product
              (2+ variants) sets these per variant on the left, so they only
              belong on the product panel while there is exactly one. */}
          {p.variants.length === 1 && (() => {
            const only = p.variants[0]!;
            const patchOnly = (data: Record<string, unknown>, local: Record<string, unknown>) => {
              setP({ ...p, variants: [{ ...only, ...local }] });
              void call('PATCH', `/api/products/${p.id}/variants/${only.id}`, data);
            };
            return (
              <>
                <label className="th-studio__field">
                  <span>SKU</span>
                  <input
                    onKeyDown={commitKeys}
                    defaultValue={only.sku ?? ''}
                    onBlur={(e) => {
                      const sku = e.target.value.trim() || null;
                      if (sku === (only.sku ?? null)) return;
                      patchOnly({ sku }, { sku });
                    }}
                  />
                </label>
                <label className="th-studio__field">
                  <span>Stock</span>
                  <select
                    defaultValue={only.stockStatus ?? 'tracked'}
                    onChange={(e) => {
                      const stockStatus = e.target.value;
                      patchOnly({ stockStatus }, { stockStatus });
                    }}
                  >
                    <option value="tracked">Track a quantity</option>
                    <option value="in_stock">In stock</option>
                    <option value="out_of_stock">Out of stock</option>
                    <option value="backorder">On back-order</option>
                  </select>
                </label>
                {(only.stockStatus ?? 'tracked') === 'tracked' && (
                  <label className="th-studio__field">
                    <span>Quantity</span>
                    <input
                      onKeyDown={commitKeys}
                      type="number" min="0" step="1"
                      defaultValue={only.inventory}
                      onBlur={(e) => {
                        const inventory = Number.parseInt(e.target.value, 10);
                        if (!Number.isFinite(inventory) || inventory === only.inventory) return;
                        patchOnly({ inventory }, { inventory });
                      }}
                    />
                  </label>
                )}
              </>
            );
          })()}

          <div className="th-studio__group-head"><span>Categories</span></div>
          <div className="th-studio__chips">
            {cats.map((c) => {
              const on = p.categories.some((x) => x.id === c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={'th-pv-chip' + (on ? ' on' : '')}
                  disabled={busy}
                  onClick={() => {
                    const categories = on ? p.categories.filter((x) => x.id !== c.id) : [...p.categories, c];
                    setP({ ...p, categories });
                    void call('PUT', `/api/products/${p.id}/taxonomy`, { categoryIds: categories.map((x) => x.id), tagIds: p.tags.map((x) => x.id) });
                  }}
                >{c.name}</button>
              );
            })}
            <button type="button" className="th-pv-chip" disabled={busy} onClick={() => { setAdding(adding === 'category' ? '' : 'category'); setTermName(''); }}>+ New</button>
          </div>
          {adding === 'category' && (
            <div className="th-studio__newvariant">
              <input autoFocus placeholder="Category name" value={termName} onChange={(e) => setTermName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addTerm('category'); if (e.key === 'Escape') setAdding(''); }} />
              <button type="button" className="th-btn th-btn-primary" disabled={busy || !termName.trim()} onClick={() => void addTerm('category')}>Add category</button>
            </div>
          )}

          <div className="th-studio__group-head"><span>Tags</span></div>
          <div className="th-studio__chips">
            {tags.map((t) => {
              const on = p.tags.some((x) => x.id === t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  className={'th-pv-chip' + (on ? ' on' : '')}
                  disabled={busy}
                  onClick={() => {
                    const tags = on ? p.tags.filter((x) => x.id !== t.id) : [...p.tags, t];
                    setP({ ...p, tags });
                    void call('PUT', `/api/products/${p.id}/taxonomy`, { categoryIds: p.categories.map((x) => x.id), tagIds: tags.map((x) => x.id) });
                  }}
                >{t.name}</button>
              );
            })}
            <button type="button" className="th-pv-chip" disabled={busy} onClick={() => { setAdding(adding === 'tag' ? '' : 'tag'); setTermName(''); }}>+ New</button>
          </div>
          {adding === 'tag' && (
            <div className="th-studio__newvariant">
              <input autoFocus placeholder="Tag name" value={termName} onChange={(e) => setTermName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addTerm('tag'); if (e.key === 'Escape') setAdding(''); }} />
              <button type="button" className="th-btn th-btn-primary" disabled={busy || !termName.trim()} onClick={() => void addTerm('tag')}>Add tag</button>
            </div>
          )}
        </>
      )}

      {sel.kind === 'image' && (
        <>
          <div className="th-studio__group-head"><span>{sel.index === -1 ? 'Primary image' : `Image ${sel.index + 1}`}</span></div>
          <img className="th-studio__preview" src={sel.index === -1 ? p.image ?? '' : gallery[sel.index]?.url ?? ''} alt="" />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" className="th-btn" onClick={() => setPickerFor(sel.index === -1 ? 'primary' : 'gallery')}>Replace</button>
            <button
              type="button"
              className="th-btn th-btn-danger"
              disabled={busy}
              onClick={() => {
                if (sel.index === -1) { setP({ ...p, image: null }); void patch({ image: null }); }
                else {
                  const images = gallery.filter((_, i) => i !== sel.index);
                  setP({ ...p, images }); void patch({ images });
                }
                setSel({ kind: 'product' });
              }}
            >Remove</button>
          </div>
        </>
      )}

      {sel.kind === 'variant' && selectedVariant && (
        <>
          <div className="th-studio__group-head"><span>Variant</span></div>
          {([
            ['sku', 'SKU', 'text'],
            ['color', 'Colour', 'text'],
            ['size', 'Size', 'text'],
          ] as const).map(([field, label]) => (
            <label className="th-studio__field" key={field}>
              <span>{label}</span>
              <input
                onKeyDown={commitKeys}
                defaultValue={(selectedVariant[field] as string | null) ?? ''}
                onBlur={(e) => {
                  const value = e.target.value.trim() || null;
                  if (value === selectedVariant[field]) return;
                  setP({ ...p, variants: p.variants.map((v) => (v.id === selectedVariant.id ? { ...v, [field]: value } : v)) });
                  void call('PATCH', `/api/products/${p.id}/variants/${selectedVariant.id}`, { [field]: value });
                }}
              />
            </label>
          ))}
          <label className="th-studio__field">
            <span>Price</span>
            {/* Entered in dollars, stored in cents — money is integer minor
                units everywhere in this codebase. */}
            <input
              onKeyDown={commitKeys}
              type="number" step="0.01" min="0"
              defaultValue={(selectedVariant.price / 100).toFixed(2)}
              onBlur={(e) => {
                const price = Math.round(Number(e.target.value) * 100);
                if (!Number.isFinite(price) || price === selectedVariant.price) return;
                setP({ ...p, variants: p.variants.map((v) => (v.id === selectedVariant.id ? { ...v, price } : v)) });
                void call('PATCH', `/api/products/${p.id}/variants/${selectedVariant.id}`, { price });
              }}
            />
          </label>
          {/* This colourway's own photographs. Product MEDIA above stays the
              product-level set; these are what the storefront shows when a
              shopper picks this colour. */}
          <div className="th-studio__group-head">
            <span>Images ({(selectedVariant.image ? 1 : 0) + (Array.isArray(selectedVariant.images) ? selectedVariant.images.length : 0)})</span>
            <button type="button" className="th-pv-chip" disabled={busy} onClick={() => setPickerFor({ variantId: selectedVariant.id })}>Add</button>
          </div>
          <div className="th-studio__vgrid">
            {[
              ...(selectedVariant.image ? [{ url: selectedVariant.image, main: true }] : []),
              ...((Array.isArray(selectedVariant.images) ? selectedVariant.images : []) as { url: string }[]).map((g) => ({ url: g.url, main: false })),
            ].map((img, i) => (
              <div key={img.url + i} className={'th-studio__vshot' + (img.main ? ' is-main' : '')}>
                <img src={img.url} alt="" />
                <div className="th-studio__vshot-acts">
                  {!img.main && (
                    <button
                      type="button" title="Make this the colour's main image" disabled={busy}
                      onClick={() => {
                        const shots = (Array.isArray(selectedVariant.images) ? selectedVariant.images : []) as { url: string; alt?: string }[];
                        // The old main is kept, not discarded — swapping which
                        // photo leads should never lose one.
                        const rest = shots.filter((g) => g.url !== img.url);
                        const next = { image: img.url, images: selectedVariant.image ? [{ url: selectedVariant.image }, ...rest] : rest };
                        setP({ ...p, variants: p.variants.map((x) => (x.id === selectedVariant.id ? { ...x, ...next } : x)) });
                        void call('PATCH', `/api/products/${p.id}/variants/${selectedVariant.id}`, next);
                      }}
                    >★</button>
                  )}
                  <button
                    type="button" title="Remove" disabled={busy}
                    onClick={() => {
                      const shots = (Array.isArray(selectedVariant.images) ? selectedVariant.images : []) as { url: string; alt?: string }[];
                      const next = img.main
                        // Removing the main promotes the next one rather than
                        // leaving the colour with no picture to swap to.
                        ? { image: shots[0]?.url ?? null, images: shots.slice(1) }
                        : { images: shots.filter((g) => g.url !== img.url) };
                      setP({ ...p, variants: p.variants.map((x) => (x.id === selectedVariant.id ? { ...x, ...next } : x)) });
                      void call('PATCH', `/api/products/${p.id}/variants/${selectedVariant.id}`, next);
                    }}
                  >×</button>
                </div>
              </div>
            ))}
            {!selectedVariant.image && !(Array.isArray(selectedVariant.images) && selectedVariant.images.length) && (
              <p className="th-hint th-studio__empty">No images for this colour yet.</p>
            )}
          </div>
          {!!(selectedVariant.colorCodes ?? []).length && (
            <p className="th-hint">
              <span className="th-studio__vthumb" style={{ ...swatchStyle(selectedVariant.colorCodes), width: 14, height: 14, display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />
              {selectedVariant.color} · {(selectedVariant.colorCodes ?? []).join(' + ')}
            </p>
          )}
          <label className="th-studio__field">
            <span>Stock</span>
            {/* Status first. The quantity box appears only for "Set a
                quantity" — a number sitting next to "In stock" invites a
                merchant to type one that is then ignored. */}
            <select
              value={selectedVariant.stockStatus ?? 'tracked'}
              onChange={(e) => {
                const stockStatus = e.target.value;
                setP({ ...p, variants: p.variants.map((v) => (v.id === selectedVariant.id ? { ...v, stockStatus } : v)) });
                void call('PATCH', `/api/products/${p.id}/variants/${selectedVariant.id}`, { stockStatus });
              }}
            >
              <option value="in_stock">In stock</option>
              <option value="out_of_stock">Out of stock</option>
              <option value="backorder">On backorder</option>
              <option value="tracked">Set a quantity…</option>
            </select>
          </label>
          {(selectedVariant.stockStatus ?? 'tracked') === 'tracked' && (
            <label className="th-studio__field">
              <span>Quantity</span>
              <input
                onKeyDown={commitKeys}
                type="number" min="0"
                defaultValue={selectedVariant.inventory}
                onBlur={(e) => {
                  const inventory = Number.parseInt(e.target.value, 10);
                  if (!Number.isFinite(inventory) || inventory === selectedVariant.inventory) return;
                  setP({ ...p, variants: p.variants.map((v) => (v.id === selectedVariant.id ? { ...v, inventory } : v)) });
                  void call('PATCH', `/api/products/${p.id}/variants/${selectedVariant.id}`, { inventory });
                }}
              />
            </label>
          )}
          <p className="th-hint">{selectedVariant.reserved} reserved by open orders.</p>
          <button
            type="button" className="th-btn th-btn-danger" disabled={busy}
            onClick={async () => {
              const ok = await call('DELETE', `/api/products/${p.id}/variants/${selectedVariant.id}`);
              if (ok !== null) { setP({ ...p, variants: p.variants.filter((v) => v.id !== selectedVariant.id) }); setSel({ kind: 'product' }); }
            }}
          >Delete variant</button>
        </>
      )}

      <div className="th-studio__group-head" style={{ marginTop: 20 }}>
        <span>Variants</span>
        <button type="button" className="th-pv-chip" disabled={busy} onClick={() => setAdding(adding === 'variant' ? '' : 'variant')}>
          {adding === 'variant' ? 'Cancel' : '+ Add a variant'}
        </button>
      </div>
      {/* The variants as pills, the same shape as Categories and Tags above.
          Clicking one selects it — the left rail and this panel drive the same
          selection, so there is one idea of "the variant being edited" rather
          than two lists that can disagree. */}
      <div className="th-studio__chips">
        {p.variants.map((v) => (
          <button
            key={v.id}
            type="button"
            className={'th-pv-chip' + (sel.kind === 'variant' && sel.id === v.id ? ' on' : '')}
            onClick={() => setSel({ kind: 'variant', id: v.id })}
          >{[v.color, v.size].filter(Boolean).join(' / ') || v.sku || 'Variant'}</button>
        ))}
        {!p.variants.length && <span className="th-hint">None yet.</span>}
      </div>
      {adding === 'variant' && (
      <div className="th-studio__newvariant">
        {(['sku', 'color', 'size'] as const).map((f) => (
          <input key={f} placeholder={f === 'sku' ? 'SKU' : f === 'color' ? 'Colour' : 'Size'} value={newVariant[f]} onChange={(e) => setNewVariant({ ...newVariant, [f]: e.target.value })} />
        ))}
        <input placeholder="Price" type="number" step="0.01" value={newVariant.price} onChange={(e) => setNewVariant({ ...newVariant, price: e.target.value })} />
        <select value={newVariant.stockStatus} onChange={(e) => setNewVariant({ ...newVariant, stockStatus: e.target.value })}>
          <option value="in_stock">In stock</option>
          <option value="out_of_stock">Out of stock</option>
          <option value="backorder">On backorder</option>
          <option value="tracked">Set a quantity…</option>
        </select>
        {newVariant.stockStatus === 'tracked' && (
          <input placeholder="Quantity" type="number" min="0" value={newVariant.inventory} onChange={(e) => setNewVariant({ ...newVariant, inventory: e.target.value })} />
        )}
        <button
          type="button" className="th-btn th-btn-primary" disabled={busy}
          onClick={async () => {
            const created = await call('POST', `/api/products/${p.id}/variants`, {
              sku: newVariant.sku || null,
              color: newVariant.color || null,
              size: newVariant.size || null,
              price: Math.round(Number(newVariant.price || 0) * 100),
              inventory: newVariant.stockStatus === 'tracked' ? Number.parseInt(newVariant.inventory, 10) || 0 : 0,
              stockStatus: newVariant.stockStatus,
            });
            if (created) {
              setP({ ...p, variants: [...p.variants, created as EditorProduct['variants'][number]] });
              setNewVariant({ sku: '', price: '', color: '', size: '', inventory: '0', stockStatus: 'in_stock' });
              setAdding('');
            }
          }}
        >Add variant</button>
      </div>
      )}
    </div>
  );

  return (
    <section className="th-studio">
      <header className="th-studio__top">
        <a href={`${BASE_PATH}/products`} className="th-hint">← Product Catalog</a>
        <div className="th-studio__title">
          <h1>{p.name || 'Untitled product'}</h1>
          <span className={'pill pill-' + p.status}>{p.status}</span>
          {busy && <span className="th-studio__save is-busy">Saving…</span>}
          {saved && !busy && <span className="th-studio__save is-ok">✓ Saved</span>}
          {!busy && !saved && <span className="th-hint">Every change saves on its own.</span>}
        </div>
        {/*
          Publish / Unpublish, in the header where it is expected.

          The editor autosaves every field, so there is no "Save" to do — but a
          product does not go live until it is ACTIVE, and burying that in a
          status dropdown left no visible way to publish. This is the missing
          affordance: one button that flips draft <-> active, saying plainly
          which state the product is in.

          A product with no price should not be publishable — a $0.00 product
          is almost never intended, and the storefront reads it as "sold out".
        */}
        <div className="th-studio__actions">
          <a className="th-btn" href={`/product/${p.slug}`} target="_blank" rel="noreferrer">Preview ↗</a>
          {p.status === 'active' ? (
            <button
              type="button"
              className="th-btn"
              disabled={busy}
              onClick={() => { setP({ ...p, status: 'draft' }); void patch({ status: 'draft' }); }}
            >Unpublish</button>
          ) : (
            <button
              type="button"
              className="th-btn th-btn--primary"
              disabled={busy || !p.variants.some((v) => v.price > 0)}
              title={p.variants.some((v) => v.price > 0) ? 'Make this product live' : 'Set a price before publishing'}
              onClick={() => { setP({ ...p, status: 'active' }); void patch({ status: 'active' }); }}
            >Publish</button>
          )}
        </div>
      </header>
      {error && <div className="notice">{error}</div>}

      <div className="th-studio__cols">
        {left}
        {centre}
        {inspector}
      </div>

      <MediaPicker
        open={pickerFor !== null}
        kind="image"
        onClose={() => setPickerFor(null)}
        onPick={(asset) => {
          if (pickerFor && typeof pickerFor === 'object') {
            // Straight onto the VARIANT. Its first image is the one the
            // storefront swaps to when a shopper picks that colour, so an
            // empty variant takes the new picture as its main.
            const v = p.variants.find((x) => x.id === pickerFor.variantId);
            if (v) {
              const shots = Array.isArray(v.images) ? v.images : [];
              const next = v.image
                ? { images: [...shots, { url: asset.url, alt: asset.alt ?? undefined }] }
                : { image: asset.url };
              setP({ ...p, variants: p.variants.map((x) => (x.id === v.id ? { ...x, ...next } : x)) });
              void call('PATCH', `/api/products/${p.id}/variants/${v.id}`, next);
            }
          } else if (pickerFor === 'primary') {
            setP({ ...p, image: asset.url });
            void patch({ image: asset.url });
          } else {
            const images = [...gallery, { url: asset.url, alt: asset.alt ?? undefined }];
            setP({ ...p, images });
            void patch({ images });
          }
          setPickerFor(null);
        }}
      />
    </section>
  );
}
