import type { ReactNode } from 'react';
import { PaymentsTabs } from './PaymentsTabs';

// Counter › Payments & Transactions — the shell every payments screen plugs
// into. One header, the WooPayments-style tab row, then the active screen.
export default function PaymentsLayout({ children }: { children: ReactNode }) {
  return (
    <section>
      <h1 style={{ marginBottom: 2 }}>Payments &amp; Transactions</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Balance, payouts, the money ledger and disputes — read live from your Stripe account.
      </p>
      <PaymentsTabs />
      {children}
    </section>
  );
}
