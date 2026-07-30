'use client';

import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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

export function ProductStudio({
  initial,
  allCategories,
  allTags,
}: {
  initial: EditorProduct;
  allCategories: Term[];
  allTags: Term[];
}) {
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
  const [pickerFor, setPickerFor] = useState<null | 'primary' | 'gallery'>(null);
  const [newVariant, setNewVariant] = useState({ sku: '', price: '', color: '', size: '', inventory: '0' });

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

      <div className="th-studio__group">
        <div className="th-studio__group-head"><span>Variants ({p.variants.length})</span></div>
        {p.variants.map((v) => (
          <button
            key={v.id}
            type="button"
            className={'th-studio__item th-studio__item--row' + (sel.kind === 'variant' && sel.id === v.id ? ' is-sel' : '')}
            onClick={() => setSel({ kind: 'variant', id: v.id })}
          >
            <span>{[v.color, v.size].filter(Boolean).join(' / ') || v.sku || 'Variant'}</span>
            <span className="th-hint">{money(v.price)}</span>
          </button>
        ))}
        {!p.variants.length && <p className="th-hint th-studio__empty">No variants — add one on the right.</p>}
      </div>
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
          <div className="th-pv-card">
            <div className="th-pv-card__media">
              {p.image ? <img src={p.image} alt={p.name} /> : <span className="th-hint">No image</span>}
            </div>
            <div className="th-pv-card__body">
              <div className="th-pv-card__name">{p.name || 'Untitled product'}</div>
              {!!p.categories.length && <div className="th-pv-card__sub">{p.categories[0]?.name}</div>}
              <div className="th-pv-card__price">
                {p.variants.length > 1 ? `From ${money(lowest)}` : money(lowest)}
              </div>
            </div>
          </div>
        ) : (
          <div className="th-pv-page">
            <div className="th-pv-page__media">
              {p.image ? <img src={p.image} alt={p.name} /> : <span className="th-hint">No image</span>}
              {gallery.length > 0 && (
                <div className="th-pv-page__strip">
                  {gallery.slice(0, 5).map((g, i) => <img key={`${g.url}-${i}`} src={g.url} alt="" />)}
                </div>
              )}
            </div>
            <div className="th-pv-page__info">
              <h2>{p.name || 'Untitled product'}</h2>
              <div className="th-pv-page__price">{p.variants.length > 1 ? `From ${money(lowest)}` : money(lowest)}</div>
              {!!p.variants.length && (
                <div className="th-pv-page__variants">
                  {p.variants.map((v) => (
                    <span key={v.id} className={'th-pv-chip' + (sel.kind === 'variant' && sel.id === v.id ? ' on' : '')}>
                      {[v.color, v.size].filter(Boolean).join(' / ') || v.sku || '—'}
                    </span>
                  ))}
                </div>
              )}
              <p className="th-pv-page__desc">{p.description || 'No description yet.'}</p>
              <button type="button" className="th-btn th-btn-primary" disabled>Add to cart</button>
            </div>
          </div>
        )}
      </div>
      <p className="th-hint th-studio__note">
        A preview, not the live page — card styling follows Customization, which this does not re-implement.
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
          <label className="th-studio__field">
            <span>Description</span>
            <textarea onKeyDown={commitKeys} rows={5} defaultValue={p.description ?? ''} onBlur={(e) => { const description = e.target.value; if (description !== (p.description ?? '')) { setP({ ...p, description }); void patch({ description }); } }} />
          </label>

          <div className="th-studio__group-head"><span>Categories</span></div>
          <div className="th-studio__chips">
            {allCategories.map((c) => {
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
          </div>

          <div className="th-studio__group-head"><span>Tags</span></div>
          <div className="th-studio__chips">
            {allTags.map((t) => {
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
          </div>
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
          <label className="th-studio__field">
            <span>Stock</span>
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

      <div className="th-studio__group-head" style={{ marginTop: 20 }}><span>Add a variant</span></div>
      <div className="th-studio__newvariant">
        {(['sku', 'color', 'size'] as const).map((f) => (
          <input key={f} placeholder={f === 'sku' ? 'SKU' : f === 'color' ? 'Colour' : 'Size'} value={newVariant[f]} onChange={(e) => setNewVariant({ ...newVariant, [f]: e.target.value })} />
        ))}
        <input placeholder="Price" type="number" step="0.01" value={newVariant.price} onChange={(e) => setNewVariant({ ...newVariant, price: e.target.value })} />
        <button
          type="button" className="th-btn th-btn-primary" disabled={busy}
          onClick={async () => {
            const created = await call('POST', `/api/products/${p.id}/variants`, {
              sku: newVariant.sku || null,
              color: newVariant.color || null,
              size: newVariant.size || null,
              price: Math.round(Number(newVariant.price || 0) * 100),
              inventory: Number.parseInt(newVariant.inventory, 10) || 0,
            });
            if (created) {
              setP({ ...p, variants: [...p.variants, created as EditorProduct['variants'][number]] });
              setNewVariant({ sku: '', price: '', color: '', size: '', inventory: '0' });
            }
          }}
        >Add variant</button>
      </div>
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
          {!busy && !saved && <span className="th-hint">Changes save as you go — Enter to commit, Esc to revert.</span>}
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
          if (pickerFor === 'primary') {
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
