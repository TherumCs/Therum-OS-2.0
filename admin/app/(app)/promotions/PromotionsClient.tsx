'use client';

import { useState } from 'react';
import { CouponsTab, type CouponRow, type MilieuOption } from './CouponsTab';
import { OffersClient, type CustomerRow, type OfferRow } from './OffersClient';
import { MarginFloor } from './MarginFloor';

// Promotions — everything that takes money off an order, in one place.
//
// Coupons and Offers are two halves of the same thing and were previously in
// two different rooms: a coupon is the RULE (amount, minimum, expiry, limits,
// who is eligible) and an offer is the DELIVERY (which customer was told,
// what they were told, whether they took it). Pushing an offer requires a
// coupon to push, so having them apart meant leaving one screen to create the
// thing the other screen needs.
//
// Tabs rather than one long page: a merchant is either writing rules or
// sending campaigns, rarely both in the same minute.
type Tab = 'coupons' | 'offers';

export function PromotionsClient({
  coupons,
  milieus,
  offers,
  customers,
  minMarginPct,
  loadError,
}: {
  coupons: CouponRow[];
  milieus: MilieuOption[];
  offers: OfferRow[];
  customers: CustomerRow[];
  minMarginPct: number;
  loadError?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('coupons');

  const TABS: { id: Tab; label: string; count: number }[] = [
    { id: 'coupons', label: 'Coupons', count: coupons.length },
    { id: 'offers', label: 'Offers', count: offers.length },
  ];

  return (
    <div style={{ display: 'grid', gap: 'var(--th-space-16)' }}>
      {loadError && <div className="notice">Couldn&apos;t reach the backend — the lists below may be incomplete.</div>}

      <div className="th-tabs" role="tablist" aria-label="Promotions">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={'th-tab' + (tab === t.id ? ' on' : '')}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count > 0 && <span className="th-tab__count">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* The floor sits above the tabs because it constrains BOTH of them,
          and a Milieus discount besides — it is not a coupon setting. */}
      <MarginFloor initial={minMarginPct} />

      {tab === 'coupons' && <CouponsTab initial={coupons} milieus={milieus} />}
      {tab === 'offers' && <OffersClient initialOffers={offers} coupons={coupons} customers={customers} />}
    </div>
  );
}
