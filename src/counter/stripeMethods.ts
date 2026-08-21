import { connectionService } from '../services/connection.service.js';
import { settingsService } from '../services/settings.service.js';
import { ValidationError } from '../lib/errors.js';

// Turning Stripe payment methods on and off from Therum OS.
//
// The reason this exists rather than "go to the Stripe dashboard": the method
// strip in this store lists what it COULD route (methodRegistry.ts), and Stripe
// separately holds what it will ACCEPT. When those disagree the shopper finds
// out at the moment of payment — they pick Klarna, and Stripe refuses. One
// screen that reads and writes the real Stripe state keeps them in step.
//
// A CONFIGURATION, not "the account". An account can hold several, and every
// Connect platform that ever onboarded the merchant leaves one behind — this
// account has five, four of them flagged is_default. So both reading and
// writing are always against an explicit id.

const API = 'https://api.stripe.com/v1';

/** The Stripe method ids this store's registry can actually route to. */
export const ROUTABLE = [
  'card', 'apple_pay', 'google_pay', 'link',
  'klarna', 'affirm', 'afterpay_clearpay',
  'cashapp', 'us_bank_account',
] as const;

export interface StripeConfig {
  id: string;
  name: string;
  isDefault: boolean;
  active: boolean;
  /** Set when this configuration belongs to a Connect platform, not this store. */
  parent: string | null;
  methods: { id: string; on: boolean; routable: boolean }[];
}

async function key(): Promise<string> {
  const k = await connectionService.credentialFor('stripe');
  if (!k) throw new ValidationError('Stripe is not connected.', 'stripe');
  return k;
}

function readMethods(c: Record<string, unknown>): StripeConfig['methods'] {
  const out: StripeConfig['methods'] = [];
  for (const [id, v] of Object.entries(c)) {
    if (!v || typeof v !== 'object') continue;
    const pref = (v as { display_preference?: { value?: string } }).display_preference;
    if (!pref) continue;
    out.push({ id, on: pref.value === 'on', routable: (ROUTABLE as readonly string[]).includes(id) });
  }
  // Routable first, then alphabetical — the ones this store can actually offer
  // are the ones worth deciding about.
  return out.sort((a, b) => (Number(b.routable) - Number(a.routable)) || a.id.localeCompare(b.id));
}

export const stripeMethods = {
  /** Every configuration on the account, with which is pinned for checkout. */
  async list(): Promise<{ configs: StripeConfig[]; pinned: string | null; suggested: string | null }> {
    const res = await fetch(`${API}/payment_method_configurations`, {
      headers: { authorization: `Bearer ${await key()}` },
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json()) as { data?: Record<string, unknown>[]; error?: { message?: string } };
    if (!res.ok) throw new ValidationError(json.error?.message ?? 'Stripe refused the request.', 'stripe');

    const configs: StripeConfig[] = (json.data ?? []).map((c) => ({
      id: String(c.id),
      name: String(c.name ?? ''),
      isDefault: c.is_default === true,
      active: c.active === true,
      parent: typeof c.parent === 'string' ? c.parent : null,
      methods: readMethods(c),
    }));

    const pinned = (await settingsService.getPayments()).stripePaymentMethodConfiguration || null;
    // The store's OWN configuration is the one with no parent. A platform's
    // config can be edited and then silently overridden by that platform.
    const suggested = configs.find((c) => c.active && !c.parent)?.id ?? null;
    return { configs, pinned, suggested };
  },

  /** Pin the configuration every PaymentIntent will use. */
  async pin(configId: string): Promise<void> {
    const { configs } = await this.list();
    const found = configs.find((c) => c.id === configId);
    if (!found) throw new ValidationError('No such Stripe payment method configuration.', 'configId');
    if (found.parent) {
      // Editing a platform's configuration appears to work and is then
      // overwritten by the platform. Refusing here beats debugging that later.
      throw new ValidationError(
        'That configuration belongs to a connected platform and cannot be managed here. Pick the one with no parent.',
        'configId',
      );
    }
    const current = await settingsService.getPayments();
    await settingsService.setPayments({ ...current, stripePaymentMethodConfiguration: configId });
  },

  /** Turn one method on or off, on a configuration this store owns. */
  async setMethod(configId: string, methodId: string, on: boolean): Promise<void> {
    const { configs } = await this.list();
    const found = configs.find((c) => c.id === configId);
    if (!found) throw new ValidationError('No such Stripe payment method configuration.', 'configId');
    if (found.parent) {
      throw new ValidationError('That configuration belongs to a connected platform and cannot be edited here.', 'configId');
    }
    if (!found.methods.some((m) => m.id === methodId)) {
      throw new ValidationError(`Stripe does not offer "${methodId}" on this configuration.`, 'methodId');
    }

    const res = await fetch(`${API}/payment_method_configurations/${configId}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await key()}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: `${methodId}[display_preference][preference]=${on ? 'on' : 'off'}`,
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json()) as { error?: { message?: string } };
    if (!res.ok) {
      // Stripe refuses methods the account is not approved for, and its message
      // names the reason (eligibility, country, agreement). Pass it through —
      // "could not enable Klarna" tells the operator nothing they can act on.
      throw new ValidationError(json.error?.message ?? 'Stripe refused that change.', 'methodId');
    }
  },

  /**
   * Where this store's method strip and Stripe DISAGREE.
   *
   * The whole point of the screen: a method this store will offer and Stripe
   * will refuse is a checkout failure in waiting, and it is invisible until a
   * shopper hits it.
   */
  async drift(): Promise<{ offeredButOff: string[]; onButNotOffered: string[]; configId: string | null }> {
    const { configs, pinned, suggested } = await this.list();
    const id = pinned ?? suggested;
    const config = configs.find((c) => c.id === id);
    if (!config) return { offeredButOff: [], onButNotOffered: [], configId: null };

    const on = new Set(config.methods.filter((m) => m.on).map((m) => m.id));
    return {
      configId: config.id,
      offeredButOff: ROUTABLE.filter((m) => !on.has(m)),
      onButNotOffered: [...on].filter((m) => !(ROUTABLE as readonly string[]).includes(m)),
    };
  },
};
