'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The WooPayments sub-menu, our version: Overview / Payouts / Transactions /
// Disputes / Settings. Same order and intent as Woo's so the muscle memory
// carries over. basePath (/tos-admin) is applied by <Link> automatically, so
// the hrefs stay app-relative.
const TABS = [
  { href: '/payments', label: 'Overview' },
  { href: '/payments/payouts', label: 'Payouts' },
  { href: '/payments/transactions', label: 'Transactions' },
  { href: '/payments/disputes', label: 'Disputes' },
  { href: '/payments/settings', label: 'Settings' },
];

export function PaymentsTabs() {
  const pathname = usePathname();
  return (
    <nav className="pay-tabs">
      {TABS.map((t) => {
        // Overview owns the bare /payments path exactly; the others match their
        // own subtree so a detail page keeps its tab lit.
        const active = t.href === '/payments' ? pathname === '/payments' : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={'pay-tab' + (active ? ' active' : '')}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
