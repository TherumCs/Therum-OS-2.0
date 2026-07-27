'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../../lib/session';
import { MediaPicker } from '../../MediaPicker';

interface Variant {
  id: string;
  sku: string | null;
  price: number;
  color: string | null;
  size: string | null;
  inventory: number;
  reserved: number;
}
interface Term {
  id: string;
  name: string;
  slug: string;
}
interface GalleryItem {
  url: string;
  alt?: string;
  type?: string;
  poster?: string;
}
export interface EditorProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image: string | null;
  images: GalleryItem[];
  status: string;
  variants: Variant[];
  categories: Term[];
  tags: Term[];
}

// Product editor (pre-Sidemoney punch list #4): the page WooCommerce calls
// "Edit product". Details, media (picker-driven), taxonomy, variants — all
// against the real API through the admin proxies.
export function ProductEditor({ initial, allCategories, allTags }: { initial: EditorProduct; allCategories: Term[]; allTags: Term[] }) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
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
        const msg = (json as { error?: { message?: string } } | null)?.error?.message ?? `Request failed (${res.status})`;
        setError(msg);
        return null;
      }
      setSaved(true);
      router.refresh();
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  const patchProduct = (body: Record<string, unknown>) => call('PATCH', `/api/products/${p.id}`, body);

  return (
    <section>
      <a href={`${BASE_PATH}/products`} className="muted" style={{ fontSize: 13 }}>← Products</a>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0 4px' }}>
        <h1 style={{ margin: 0 }}>{p.name}</h1>
        <span className={'pill pill-' + p.status}>{p.status}</span>
        {saved && <span className="pill pill-ok">Saved</span>}
      </div>
      <p className="muted" style={{ marginTop: 0 }}>/{p.slug}</p>
      {error && <div className="notice">{error}</div>}

      <div className="settings-group">
        <h3 className="settings-group-title">Details</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--th-muted)' }}>Name
            <input defaultValue={p.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== p.name) { setP({ ...p, name: e.target.value }); void patchProduct({ name: e.target.value }); } }} style={{ width: '100%', marginTop: 4 }} />
          </label>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--th-muted)' }}>Status
            <select defaultValue={p.status} onChange={(e) => { setP({ ...p, status: e.target.value }); void patchProduct({ status: e.target.value }); }} style={{ width: '100%', marginTop: 4 }}>
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="archived">archived</option>
            </select>
          </label>
        </div>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--th-muted)', display: 'block', marginTop: 12 }}>Description
          <textarea defaultValue={p.description ?? ''} rows={4} onBlur={(e) => { if (e.target.value !== (p.description ?? '')) { setP({ ...p, description: e.target.value }); void patchProduct({ description: e.target.value }); } }} style={{ width: '100%', marginTop: 4, fontFamily: 'inherit', fontSize: 14 }} placeholder="Shown on the product page." />
        </label>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Media</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Primary image</div>
            <button type="button" onClick={() => setPickerFor('primary')} style={{ width: 120, height: 120, borderRadius: 10, border: '1px dashed var(--th-line)', overflow: 'hidden', padding: 0, cursor: 'pointer', background: 'var(--th-surface)' }}>
              {p.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              ) : (
                <span className="muted" style={{ fontSize: 11 }}>+ Pick</span>
              )}
            </button>
          </div>
          <div style={{ flex: 1 }}>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Gallery ({p.images.length}) — stills flip on cards; a video plays on hover</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {p.images.map((g, i) => (
                <div key={`${g.url}-${i}`} style={{ position: 'relative' }}>
                  <div style={{ width: 72, height: 72, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--th-line)' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={g.type === 'video' ? (g.poster ?? p.image ?? '') : g.url} alt={g.alt ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </div>
                  {g.type === 'video' && <span style={{ position: 'absolute', top: 2, left: 2, fontSize: 9, background: 'rgba(0,0,0,.6)', color: '#fff', borderRadius: 4, padding: '1px 4px' }}>▶</span>}
                  <button type="button" disabled={busy} onClick={() => { const images = p.images.filter((_, x) => x !== i); setP({ ...p, images }); void patchProduct({ images }); }} style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 0, background: 'var(--th-danger, #ef4444)', color: '#fff', fontSize: 10, cursor: 'pointer', lineHeight: 1 }} aria-label="Remove">×</button>
                </div>
              ))}
              <button type="button" onClick={() => setPickerFor('gallery')} style={{ width: 72, height: 72, borderRadius: 8, border: '1px dashed var(--th-line)', background: 'transparent', cursor: 'pointer', color: 'var(--th-muted)', fontSize: 11 }}>+ Add</button>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Categories &amp; tags</h3>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {allCategories.map((c) => {
            const on = p.categories.some((x) => x.id === c.id);
            return (
              <button key={c.id} type="button" disabled={busy} className={on ? '' : 'ghost'} style={{ fontSize: 12 }} onClick={() => {
                const categories = on ? p.categories.filter((x) => x.id !== c.id) : [...p.categories, c];
                setP({ ...p, categories });
                void call('PUT', `/api/products/${p.id}/taxonomy`, { categoryIds: categories.map((x) => x.id) });
              }}>
                {c.name}
              </button>
            );
          })}
          {!allCategories.length && <span className="muted" style={{ fontSize: 12 }}>No categories yet — create them via the catalog API or import.</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {allTags.map((t) => {
            const on = p.tags.some((x) => x.id === t.id);
            return (
              <button key={t.id} type="button" disabled={busy} className={on ? '' : 'ghost'} style={{ fontSize: 12 }} onClick={() => {
                const tags = on ? p.tags.filter((x) => x.id !== t.id) : [...p.tags, t];
                setP({ ...p, tags });
                void call('PUT', `/api/products/${p.id}/taxonomy`, { tagIds: tags.map((x) => x.id) });
              }}>
                #{t.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Variants ({p.variants.length})</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--th-fs-sm)' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--th-line)' }}>
              <th style={{ padding: 6 }}>SKU</th><th style={{ padding: 6 }}>Color</th><th style={{ padding: 6 }}>Size</th>
              <th style={{ padding: 6 }}>Price (¢)</th><th style={{ padding: 6 }}>Stock</th><th style={{ padding: 6 }}>Reserved</th><th />
            </tr>
          </thead>
          <tbody>
            {p.variants.map((v) => (
              <tr key={v.id} style={{ borderBottom: '1px solid var(--th-line)' }}>
                <td style={{ padding: 6 }}><input defaultValue={v.sku ?? ''} onBlur={(e) => void call('PATCH', `/api/products/${p.id}/variants/${v.id}`, { sku: e.target.value || null })} style={{ width: 110 }} /></td>
                <td style={{ padding: 6 }}><input defaultValue={v.color ?? ''} onBlur={(e) => void call('PATCH', `/api/products/${p.id}/variants/${v.id}`, { color: e.target.value || null })} style={{ width: 90 }} /></td>
                <td style={{ padding: 6 }}><input defaultValue={v.size ?? ''} onBlur={(e) => void call('PATCH', `/api/products/${p.id}/variants/${v.id}`, { size: e.target.value || null })} style={{ width: 70 }} /></td>
                <td style={{ padding: 6 }}><input type="number" defaultValue={v.price} onBlur={(e) => void call('PATCH', `/api/products/${p.id}/variants/${v.id}`, { price: Number(e.target.value) })} style={{ width: 90 }} /></td>
                <td style={{ padding: 6 }}><input type="number" defaultValue={v.inventory} onBlur={(e) => void call('PATCH', `/api/products/${p.id}/variants/${v.id}`, { inventory: Number(e.target.value) })} style={{ width: 70 }} /></td>
                <td style={{ padding: 6 }} className="muted">{v.reserved}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>
                  <button type="button" className="ghost" disabled={busy} style={{ fontSize: 11, color: 'var(--th-danger, #ef4444)' }} onClick={() => {
                    void call('DELETE', `/api/products/${p.id}/variants/${v.id}`).then((r) => { if (r) setP({ ...p, variants: p.variants.filter((x) => x.id !== v.id) }); });
                  }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="SKU" value={newVariant.sku} onChange={(e) => setNewVariant({ ...newVariant, sku: e.target.value })} style={{ width: 110 }} />
          <input placeholder="Color" value={newVariant.color} onChange={(e) => setNewVariant({ ...newVariant, color: e.target.value })} style={{ width: 90 }} />
          <input placeholder="Size" value={newVariant.size} onChange={(e) => setNewVariant({ ...newVariant, size: e.target.value })} style={{ width: 70 }} />
          <input placeholder="Price ¢" type="number" value={newVariant.price} onChange={(e) => setNewVariant({ ...newVariant, price: e.target.value })} style={{ width: 90 }} />
          <input placeholder="Stock" type="number" value={newVariant.inventory} onChange={(e) => setNewVariant({ ...newVariant, inventory: e.target.value })} style={{ width: 70 }} />
          <button type="button" disabled={busy || !newVariant.price} onClick={() => {
            void call('POST', `/api/products/${p.id}/variants`, {
              sku: newVariant.sku || undefined,
              color: newVariant.color || undefined,
              size: newVariant.size || undefined,
              price: Number(newVariant.price),
              inventory: Number(newVariant.inventory) || 0,
            }).then((r) => {
              if (r) {
                setP({ ...p, variants: [...p.variants, r as Variant] });
                setNewVariant({ sku: '', price: '', color: '', size: '', inventory: '0' });
              }
            });
          }}>Add variant</button>
        </div>
      </div>

      <MediaPicker
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        onPick={(asset) => {
          if (pickerFor === 'primary') {
            setP({ ...p, image: asset.url });
            void patchProduct({ image: asset.url });
          } else {
            const images = [...p.images, { url: asset.url, alt: asset.alt ?? undefined }];
            setP({ ...p, images });
            void patchProduct({ images });
          }
          setPickerFor(null);
        }}
      />
    </section>
  );
}
