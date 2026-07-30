import { apiGet } from '../../../lib/api';
import { PromotionsClient } from './PromotionsClient';
import type { CouponRow, MilieuOption } from './CouponsTab';
import type { CustomerRow, OfferRow } from './OffersClient';

export const dynamic = 'force-dynamic';

// Promotions — the rules that take money off an order, and the campaigns that
// deliver them.
//
// Named Promotions rather than Marketing on purpose: marketing implies email
// and ads, and a section full of tabs with nothing behind them is worse than a
// narrow section that works. Coupons and Offers both have real backends today.
export default async function PromotionsPage() {
  let coupons: CouponRow[] = [];
  let milieus: MilieuOption[] = [];
  let offers: OfferRow[] = [];
  let customers: CustomerRow[] = [];
  let minMarginPct = 0;
  let loadError = false;

  try {
    const [c, m, o, cu] = await Promise.all([
      apiGet<CouponRow[]>('/api/coupons'),
      apiGet<MilieuOption[]>('/api/milieus').catch((): MilieuOption[] => []),
      apiGet<{ offers: OfferRow[] }>('/api/counter/offers'),
      apiGet<{ items: CustomerRow[] }>('/api/customers?limit=100'),
    ]);
    minMarginPct = (await apiGet<{ minMarginPct: number }>('/api/settings/commerce').catch(() => ({ minMarginPct: 0 }))).minMarginPct;
    coupons = c;
    milieus = m;
    offers = o.offers;
    customers = cu.items;
  } catch {
    // A backend failure must not read as "no promotions yet" — that would
    // invite someone to re-create a coupon that already exists.
    loadError = true;
  }

  const live = coupons.filter((c) => c.status === 'active' && (!c.expiresAt || new Date(c.expiresAt) > new Date())).length;
  const claimed = offers.filter((o) => o.status === 'claimed').length;

  return (
    <section>
      <div className="th-lp-header">
        <div className="th-lp-header-left">
          <div className="th-lp-meta">
            <span className="th-lp-meta-dot" />
            {coupons.length} {coupons.length === 1 ? 'COUPON' : 'COUPONS'} · {live} LIVE · {offers.length} OFFERS SENT ·{' '}
            {claimed} CLAIMED
          </div>
          <h1 className="th-lp-title">Promotions</h1>
          <p className="th-lp-sub">
            A coupon is the rule — what comes off, who can use it, how often. An offer is the delivery: that coupon sent
            to named customers, showing up in their account, with the code revealed only once they claim it.
          </p>
        </div>
      </div>

      <PromotionsClient
        coupons={coupons}
        milieus={milieus}
        offers={offers}
        customers={customers}
        minMarginPct={minMarginPct}
        loadError={loadError}
      />
    </section>
  );
}
