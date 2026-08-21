import { revalidatePath } from 'next/cache';
import { apiGet, apiSend } from '../../../../lib/api';
import { BASE_PATH } from '../../../../lib/session';
import { Field, SelectField, TextInput } from '../../settings/SettingsControls';
import { StripeMethods } from '../../connections/StripeMethods';
import type { StoreConnection } from '../../connections/StoreConnections';
import { WoopayDepositSchedule } from '../WoopayDepositSchedule';
import { WoopayMethods } from '../WoopayMethods';

export const dynamic = 'force-dynamic';

// Counter › Payments › Settings.
//
// The WooPayments settings live at the top: the deposit schedule (how often the
// engine sends your balance to the bank) and the methods a shopper sees at
// checkout, both editable here over the bridge. Below that is the direct-Stripe
// method surface (StripeMethods, the same config the storefront charges
// against), the publishable keys, Apple Pay domain verification and wallet
// readiness. Secrets themselves live in Nexus and are entered only there.

interface Payments {
  stripePublishableKey: string;
  squareApplicationId: string;
  environment: 'live' | 'sandbox';
  appleDomainAssociation: string;
}
interface WalletProvider {
  provider: string;
  wallets: string[];
  ready: boolean;
  reason?: string;
}
interface WoopaySettings {
  connected: boolean;
  error?: string;
  deposits?: {
    interval: string;
    weeklyAnchor: string | null;
    monthlyAnchor: number | null;
    delayDays: number | null;
    canManage: boolean;
  };
  methods?: { id: string; label: string; enabled: boolean; description: string | null }[];
}
const PAYMENT_DEFAULTS: Payments = {
  stripePublishableKey: '',
  squareApplicationId: '',
  environment: 'live',
  appleDomainAssociation: '',
};

// Server Actions: change the deposit cadence, or replace the enabled-method set.
// Both return a serialisable { error } for the island to render on failure.
async function woopaySaveSchedule(v: {
  interval: string;
  weekly_anchor?: string;
  monthly_anchor?: number;
}): Promise<{ error?: string } | void> {
  'use server';
  try {
    await apiSend('PUT', '/api/counter/payments/woopay/deposit-schedule', v);
    revalidatePath('/payments/settings');
    revalidatePath('/payments');
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not update the schedule.' };
  }
}

async function woopaySaveMethods(ids: string[]): Promise<{ error?: string } | void> {
  'use server';
  try {
    await apiSend('PUT', '/api/counter/payments/woopay/methods', { ids });
    revalidatePath('/payments/settings');
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save the methods.' };
  }
}

export default async function PaymentsSettingsPage() {
  const [connections, payments, wallets, woopay] = await Promise.all([
    apiGet<StoreConnection[]>('/api/connections').catch((): StoreConnection[] => []),
    apiGet<Payments>('/api/settings/payments').catch(() => PAYMENT_DEFAULTS),
    apiGet<WalletProvider[]>('/api/counter/wallets/providers').catch((): WalletProvider[] => []),
    apiGet<WoopaySettings>('/api/counter/payments/woopay/settings').catch((): WoopaySettings => ({ connected: false })),
  ]);
  const stripeConnected = connections.some((c) => c.connected && c.id === 'stripe');

  return (
    <div>
      {/* WooPayments — deposit schedule and the methods shown at checkout. */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="l">WooPayments deposit schedule</div>
        <p className="th-about-sub">
          How often the WooPayments engine sends your cleared balance to your bank. This is the account this store&apos;s
          checkout settles into.
        </p>
        {!woopay.connected ? (
          <p className="muted">
            {woopay.error ?? 'WooPayments is not connected yet — connect it from the Overview tab.'}
          </p>
        ) : (
          <WoopayDepositSchedule
            interval={woopay.deposits?.interval ?? 'daily'}
            weeklyAnchor={woopay.deposits?.weeklyAnchor ?? null}
            monthlyAnchor={woopay.deposits?.monthlyAnchor ?? null}
            delayDays={woopay.deposits?.delayDays ?? null}
            canManage={woopay.deposits?.canManage ?? false}
            onSave={woopaySaveSchedule}
          />
        )}
      </div>

      {woopay.connected && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="l">WooPayments methods at checkout</div>
          <p className="th-about-sub">
            Turn methods on or off on the WooPayments account. This is the same account checkout charges against, so the
            change lands where shoppers see it.
          </p>
          <WoopayMethods methods={woopay.methods ?? []} onSave={woopaySaveMethods} />
        </div>
      )}

      {!stripeConnected && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="l">No direct card processor connected</div>
          <p className="th-about-sub">
            Connect Stripe (or Square) in <a href={`${BASE_PATH}/settings/connections?tab=payments`}>Nexus</a> to take
            card payments through a directly-connected account and manage its methods here.
          </p>
        </div>
      )}

      {/* The direct-Stripe method surface. */}
      <StripeMethods stripeConnected={stripeConnected} />

      {/* Wallet readiness — Apple/Google Pay ride on the connected gateway. */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="l">Wallet readiness</div>
        <p className="th-about-sub">
          Apple Pay and Google Pay ride on whichever gateway processes the payment. Both parts are required: the gateway
          connected in Nexus, and its publishable key below.
        </p>
        {wallets.length === 0 && <p className="muted">Could not read wallet status — is the API running?</p>}
        {wallets.map((w) => (
          <div key={w.provider} className="settings-toggle-row">
            <div className="settings-toggle-row-text">
              <span className="settings-toggle-row-label">
                {w.provider === 'square' ? 'Square' : w.provider === 'stripe' ? 'Stripe' : w.provider === 'paypal' ? 'PayPal' : w.provider}
              </span>
              <span className="settings-toggle-row-desc">
                {w.wallets.join(' · ') || 'No wallets'}
                {w.reason ? ` — ${w.reason}` : ''}
              </span>
            </div>
            <span className={'th-about-badge' + (w.ready ? ' is-prod' : '')}>{w.ready ? 'Ready' : 'Not ready'}</span>
          </div>
        ))}
      </div>

      {/* Publishable keys — safe to expose, sent to every browser at checkout. */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="l">Publishable keys</div>
        <p className="th-about-sub">
          Safe to expose — they are sent to every browser that loads checkout. The matching secret goes in Nexus.
        </p>
        <Field label="Stripe publishable key" help="Starts with pk_live_ or pk_test_. Stripe Dashboard → Developers → API keys.">
          <TextInput domain="payments" field="stripePublishableKey" initial={payments.stripePublishableKey} placeholder="pk_live_…" />
        </Field>
        <Field label="Square application ID" help="Starts with sq0idp-. Square Developer Dashboard → your application → Credentials. NOT the access token — that goes in Nexus.">
          <TextInput domain="payments" field="squareApplicationId" initial={payments.squareApplicationId} placeholder="sq0idp-…" />
        </Field>
        <Field label="Environment" help="Sandbox uses each provider's test mode. No real money moves.">
          <SelectField domain="payments" field="environment" initial={payments.environment} options={[['live', 'Live'], ['sandbox', 'Sandbox']]} />
        </Field>
      </div>

      {/* Apple Pay domain verification. */}
      <div className="card">
        <div className="l">Apple Pay domain verification</div>
        <p className="th-about-sub">
          Apple fetches <code>/.well-known/apple-developer-merchantid-domain-association</code> from this exact domain
          over HTTPS before it will show the Apple Pay button. Missing, the button silently never appears. Paste the file
          contents from your payment provider or the Apple Developer portal.
        </p>
        <Field label="Domain association file contents">
          <TextInput domain="payments" field="appleDomainAssociation" initial={payments.appleDomainAssociation} placeholder="7B227073704964223A…" />
        </Field>
        <p className="field-help">
          {payments.appleDomainAssociation ? 'Uploaded — the file is being served.' : 'Not set. Apple Pay will not appear until this is uploaded.'}
        </p>
      </div>
    </div>
  );
}
