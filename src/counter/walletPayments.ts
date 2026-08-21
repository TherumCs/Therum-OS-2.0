import { db } from '../lib/db.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { settingsService } from '../services/settings.service.js';
import { connectionService } from '../services/connection.service.js';
import { paymentGatewayService } from '../services/paymentGateway.service.js';
import { METHODS } from '../lib/payments/methodRegistry.js';
import { woopayBridge } from './woopayBridge.js';

// Counter — in-browser wallet payments (Apple Pay, Google Pay).
//
// The method registry already declared apple_pay and google_pay against
// stripe and square. What was missing is the browser handoff: a wallet button
// is mounted by the provider's own JS SDK, and that SDK needs a PUBLISHABLE
// key plus a per-order secret before it can render anything.
//
// Publishable keys are deliberately NOT in the Nexus vault. The vault holds
// secrets; a publishable key is designed to be shipped to every browser that
// loads the checkout. Storing it as a secret would mean decrypting a secret in
// order to publish it, which muddles which values actually matter — so these
// live in ordinary settings and the vault keeps holding only real secrets.
//
// Apple Pay additionally requires DOMAIN VERIFICATION: Apple fetches
// /.well-known/apple-developer-merchantid-domain-association from the exact
// host serving checkout, and refuses to render the button otherwise. That file
// is served from settings too — see walletRoutes.

export interface WalletClientConfig {
  provider: string;
  /** Everything the provider's browser SDK needs to initialise. */
  publishableKey: string | null;
  /** Square only: the SDK needs both. */
  locationId?: string | null;
  /**
   * WooPayments only: the connected merchant account id. Stripe.js must be
   * built as new Stripe(pk, { stripeAccount }) or the intent (which belongs to
   * the connected account) cannot be confirmed in the browser.
   */
  stripeAccount?: string | null;
  environment: 'live' | 'sandbox';
}

export interface WalletSession {
  orderId: string;
  orderNumber: string;
  amount: number;
  currency: string;
  provider: string;
  clientSecret: string | null;
  /** Wallets this provider can actually present. */
  wallets: { id: string; label: string }[];
  client: WalletClientConfig;
  /** False plus a reason is more useful than an empty button that never appears. */
  ready: boolean;
  reason?: string;
}

/** Wallet methods the registry says this provider supports. */
function walletsFor(providerId: string): { id: string; label: string }[] {
  return METHODS
    .filter((m) => m.group === 'wallets' && m.providers.includes(providerId) && !m.needsRedirect)
    .map((m) => ({ id: m.id, label: m.label }));
}

export const walletPayments = {
  /**
   * Everything a checkout page needs to mount Apple Pay / Google Pay for one
   * order. Returns `ready: false` WITH a reason rather than throwing, because
   * the storefront's correct response to "wallets unavailable" is to fall back
   * to the card form, not to break.
   */
  async session(orderNumber: string, accessToken: string, providerId: string): Promise<WalletSession> {
    const order = await db.order.findFirst({
      where: { number: orderNumber, accessToken },
      select: { id: true, number: true, total: true, currency: true },
    });
    if (!order) throw new NotFoundError('Order not found', 'orderNumber');

    const wallets = walletsFor(providerId);
    const base = {
      orderId: order.id,
      orderNumber: order.number,
      amount: order.total,
      currency: order.currency,
      provider: providerId,
      wallets,
    };

    if (wallets.length === 0) {
      return {
        ...base,
        clientSecret: null,
        client: { provider: providerId, publishableKey: null, environment: 'live' },
        ready: false,
        reason: `${providerId} does not support in-browser wallets.`,
      };
    }

    const client = await this.clientConfig(providerId);
    if (!client.publishableKey) {
      return {
        ...base,
        clientSecret: null,
        client,
        ready: false,
        reason: `No publishable key configured for ${providerId} — add it under Settings → Payments.`,
      };
    }

    // The intent is what actually authorises the amount; a wallet button
    // without one can collect a token that nothing will ever capture.
    const intent = await paymentGatewayService.createIntent(orderNumber, accessToken, providerId);
    return {
      ...base,
      clientSecret: intent.clientSecret ?? null,
      client,
      ready: Boolean(intent.clientSecret) || providerId === 'square',
      ...(intent.clientSecret || providerId === 'square'
        ? {}
        : { reason: 'The payment provider did not return a client secret.' }),
    };
  },

  /** Publishable config for a provider's browser SDK. */
  async clientConfig(providerId: string): Promise<WalletClientConfig> {
    const payments = await settingsService.getPayments();
    const environment = payments.environment;

    if (providerId === 'square') {
      // Square's SDK needs the location id as well. It already lives inside
      // the vault credential ("accessToken|locationId|env"), so it is read
      // from there rather than stored twice and allowed to drift.
      const credential = await connectionService.credentialFor('square');
      const locationId = credential?.split('|')[1] ?? null;
      return {
        provider: 'square',
        publishableKey: payments.squareApplicationId || null,
        locationId,
        environment,
      };
    }

    if (providerId === 'stripe') {
      return { provider: 'stripe', publishableKey: payments.stripePublishableKey || null, environment };
    }

    if (providerId === 'woopay') {
      // Publishable key + account id come from the engine, not settings — they
      // belong to the WooPayments merchant, not our direct-Stripe key.
      const keys = await woopayBridge.clientKeys();
      return { provider: 'woopay', publishableKey: keys.publishableKey, stripeAccount: keys.accountId, environment };
    }

    return { provider: providerId, publishableKey: null, environment };
  },

  /**
   * The file Apple fetches to prove this domain may present Apple Pay.
   *
   * Apple requests it over HTTPS at the exact checkout host and will not
   * render the button if it 404s or does not match — which is the single most
   * common reason "Apple Pay just doesn't show up".
   */
  async appleDomainAssociation(): Promise<string> {
    const payments = await settingsService.getPayments();
    if (!payments.appleDomainAssociation.trim()) {
      throw new NotFoundError(
        'No Apple Pay domain association file uploaded — add it under Settings → Payments to enable Apple Pay.',
        'appleDomainAssociation',
      );
    }
    return payments.appleDomainAssociation;
  },

  /** Which wallet-capable providers are actually usable right now. */
  /**
   * Express payment options for the storefront's top row.
   *
   * `kind` matters. 'token' providers hand the browser a token their SDK
   * produced, which our own Pay call then settles — that is what Apple Pay,
   * Google Pay and Link do through Stripe or Square. PayPal does not work
   * that way: it approves in its own popup and is captured server-side, so
   * routing it through the token path would throw at assertWalletProvider.
   * Reporting the kind lets the card render the button without pretending
   * the two flows are interchangeable.
   */
  async availableProviders(): Promise<{ provider: string; wallets: string[]; ready: boolean; kind: 'token' | 'redirect' | 'confirm'; reason?: string }[]> {
    const out = [];
    // PayPal carries Venmo behind the same button in the US, which is why it
    // is one entry here and not two. PayPal is its own rail (its own account)
    // and is UNAFFECTED by the card-provider flag.
    const paypalCredential = await connectionService.credentialFor('paypal');
    out.push({
      provider: 'paypal',
      wallets: ['paypal'],
      kind: 'redirect' as const,
      ready: Boolean(paypalCredential),
      ...(paypalCredential ? {} : { reason: 'PayPal is not connected in Nexus.' }),
    });

    // When cardProvider is 'woopay' the card + Apple/Google Pay rail settles
    // IN-PAGE against the WooPayments merchant account (kind 'confirm'), and the
    // direct-Stripe token entry is dropped entirely so no card/wallet money can
    // land in the other account. Default 'stripe' keeps the exact old behaviour.
    const payments = await settingsService.getPayments();
    if (payments.cardProvider === 'woopay') {
      const client = await this.clientConfig('woopay');
      const ready = Boolean(client.publishableKey && client.stripeAccount);
      out.push({
        provider: 'woopay',
        wallets: ['apple_pay', 'google_pay'],
        kind: 'confirm' as const,
        ready,
        ...(ready ? {} : { reason: 'The WooPayments engine is unreachable — cards cannot be taken right now.' }),
      });
      return out;
    }

    for (const providerId of ['stripe', 'square']) {
      const wallets = walletsFor(providerId).map((w) => w.id);
      const credential = await connectionService.credentialFor(providerId);
      const client = await this.clientConfig(providerId);
      const ready = Boolean(credential) && Boolean(client.publishableKey);
      out.push({
        provider: providerId,
        wallets,
        kind: 'token' as const,
        ready,
        ...(ready
          ? {}
          : {
              reason: !credential
                ? `${providerId} is not connected in Nexus.`
                : `${providerId} has no publishable key set.`,
            }),
      });
    }
    return out;
  },
};

/** Guards a provider id before it reaches a gateway lookup. */
export function assertWalletProvider(providerId: string): void {
  if (!['stripe', 'square'].includes(providerId)) {
    throw new ValidationError(`${providerId} does not support in-browser wallets.`, 'provider');
  }
}
