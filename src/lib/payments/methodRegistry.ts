// Counter — payment method registry. 1:1 port of 1.x
// includes/Payments/Studio/MethodRegistry.php: the source of truth for every
// method the checkout method strip exposes. Groups (strip order):
// card | wallets | bnpl | bank | crypto | p2p. Each method lists the ordered
// providers that can fulfil it — the router picks the first CONNECTED one.
// Methods with no connected provider still render, disabled, as
// "setup required" (Bam's ruling: show what's possible, light up on connect).

export interface PaymentMethod {
  id: string;
  group: 'card' | 'wallets' | 'bnpl' | 'bank' | 'crypto' | 'p2p';
  label: string;
  providers: string[];
  needsRedirect: boolean;
  sub?: string; // panel row subtitle (ported from the 1.x checkout copy)
}

export const METHOD_GROUPS: { id: PaymentMethod['group']; label: string; ico: string; preview: string }[] = [
  { id: 'card', label: 'Card', ico: 'CC', preview: 'Pay with debit or credit. Most common method.' },
  { id: 'wallets', label: 'Wallets', ico: '⌘', preview: 'Apple Pay · Google Pay · PayPal · Shop Pay' },
  { id: 'bnpl', label: 'Pay later', ico: '4×', preview: 'Split into 4 payments · 0% interest' },
  { id: 'bank', label: 'Bank', ico: '⏧', preview: 'Direct from your bank account · saves 2% in fees' },
  { id: 'crypto', label: 'Crypto', ico: '₿', preview: 'BTC · ETH · USDC · SOL · ~10 min confirmation' },
  { id: 'p2p', label: 'P2P', ico: '$', preview: 'Cash App · Venmo · Zelle · Tap to scan QR' },
];

export const METHODS: PaymentMethod[] = [
  // ── Card ── ('mock' appended as the dev/testing card rail only)
  { id: 'card', group: 'card', label: 'Card', providers: ['stripe', 'square', 'mock'], needsRedirect: false, sub: 'Debit or credit' },

  // ── Wallets ──
  { id: 'apple_pay', group: 'wallets', label: 'Apple Pay', providers: ['stripe', 'square'], needsRedirect: false },
  { id: 'google_pay', group: 'wallets', label: 'Google Pay', providers: ['stripe', 'square'], needsRedirect: false },
  { id: 'link', group: 'wallets', label: 'Link (Stripe)', providers: ['stripe'], needsRedirect: false },
  { id: 'paypal', group: 'wallets', label: 'PayPal', providers: ['paypal'], needsRedirect: true },
  { id: 'shop_pay', group: 'wallets', label: 'Shop Pay', providers: ['shop_pay'], needsRedirect: true },

  // ── BNPL ──
  { id: 'klarna', group: 'bnpl', label: 'Klarna', providers: ['stripe'], needsRedirect: true, sub: '0% interest · every 2 weeks' },
  { id: 'affirm', group: 'bnpl', label: 'Affirm', providers: ['stripe'], needsRedirect: true, sub: 'Rates from 0% to 36% APR' },
  { id: 'afterpay', group: 'bnpl', label: 'Afterpay', providers: ['stripe', 'square'], needsRedirect: true, sub: '0% interest · every 2 weeks' },
  { id: 'sezzle', group: 'bnpl', label: 'Sezzle', providers: ['sezzle'], needsRedirect: true, sub: '0% interest · every 2 weeks · soft credit check' },
  { id: 'zip', group: 'bnpl', label: 'Zip', providers: ['zip'], needsRedirect: true, sub: 'Bi-weekly · $1 fee per installment' },
  { id: 'paypal_credit', group: 'bnpl', label: 'PayPal Credit', providers: ['paypal'], needsRedirect: true, sub: '6 months no interest on $99+' },

  // ── Bank ──
  { id: 'bank_ach', group: 'bank', label: 'Bank (Plaid)', providers: ['plaid', 'stripe'], needsRedirect: true, sub: 'Pay directly from your bank account. Saves ~2% in card fees.' },

  // ── Crypto ── (each coin its own toggle — AnyPay rail underneath)
  { id: 'crypto_btc', group: 'crypto', label: 'BTC', providers: ['crypto'], needsRedirect: true },
  { id: 'crypto_eth', group: 'crypto', label: 'ETH', providers: ['crypto'], needsRedirect: true },
  { id: 'crypto_usdc', group: 'crypto', label: 'USDC', providers: ['crypto'], needsRedirect: true },
  { id: 'crypto_usdt', group: 'crypto', label: 'USDT', providers: ['crypto'], needsRedirect: true },
  { id: 'crypto_sol', group: 'crypto', label: 'SOL', providers: ['crypto'], needsRedirect: true },
  { id: 'crypto_xrp', group: 'crypto', label: 'XRP', providers: ['crypto'], needsRedirect: true },

  // ── P2P ── (Cash App via Stripe primary → instant payout to Square Debit;
  // Venmo rides PayPal Smart Buttons; NO CHECKS EVER.)
  { id: 'cashapp', group: 'p2p', label: 'Cash App', providers: ['stripe', 'square'], needsRedirect: true },
  { id: 'venmo', group: 'p2p', label: 'Venmo', providers: ['paypal'], needsRedirect: true },
  { id: 'zelle', group: 'p2p', label: 'Zelle', providers: ['zelle'], needsRedirect: true },
];
