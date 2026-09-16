import { apiGet } from '../../../lib/api';
import { CopyField } from './CopyField';

export const dynamic = 'force-dynamic';

interface FeedChannel {
  key: string;
  label: string;
  format: string;
  connect: string;
  url: string;
}
interface FeedsResponse {
  origin: string;
  productCount: number;
  variantCount: number;
  channels: FeedChannel[];
}

export default async function FeedsPage() {
  let data: FeedsResponse | null = null;
  let err: string | null = null;
  try {
    data = await apiGet<FeedsResponse>('/api/feeds');
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  return (
    <section>
      <h1>Feeds</h1>
      <p className="th-hint" style={{ marginTop: 4, maxWidth: 640 }}>
        Your live product catalog, formatted for the shopping channels. Point Meta and Google at
        these URLs once — the feed regenerates itself on every fetch, so new products, price
        changes, and sell-outs flow through without re-uploading anything.
      </p>

      {err && <div className="notice" style={{ marginTop: 12 }}>Feed service offline ({err})</div>}

      {data && (
        <>
          <div className="th-order__side" style={{ maxWidth: 640, marginTop: 16 }}>
            <div className="th-order__row">
              <span>Products in feed</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{data.productCount}</span>
            </div>
            <div className="th-order__row">
              <span>Variants (feed items)</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{data.variantCount}</span>
            </div>
            <p className="th-hint" style={{ marginTop: 6 }}>
              Counts eligible items only: public, active, priced, with an image. A draft, hidden, or
              $0 variant is excluded — the same rule the feed itself applies.
            </p>
          </div>

          <div style={{ display: 'grid', gap: 16, marginTop: 20, gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
            {data.channels.map((c) => (
              <div
                key={c.key}
                style={{ border: '1px solid var(--th-line)', borderRadius: 12, padding: 16, background: 'var(--th-surface)' }}
              >
                <div className="th-studio__group-head" style={{ marginTop: 0 }}><span>{c.label}</span></div>
                <p className="th-hint" style={{ margin: '2px 0 10px' }}>{c.format}</p>
                <CopyField url={c.url} />
                <div className="th-studio__group-head" style={{ marginTop: 16 }}><span>Connect</span></div>
                <p className="th-hint" style={{ marginTop: 4 }}>{c.connect}</p>
              </div>
            ))}
          </div>

          <div className="th-studio__group-head" style={{ marginTop: 24 }}><span>Attribution</span></div>
          <p className="th-hint" style={{ maxWidth: 640 }}>
            Each channel&apos;s links carry its own <code>th_src</code> tag, so an order that starts from
            Meta or Google is stamped with that source and shows up under it in the dashboard&apos;s
            activity — the order lands where it came from.
          </p>
        </>
      )}
    </section>
  );
}
