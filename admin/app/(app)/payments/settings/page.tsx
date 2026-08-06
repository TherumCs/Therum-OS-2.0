import { apiGet } from '../../../../lib/api';
import { BASE_PATH } from '../../../../lib/session';
import { Field, SelectField, TextInput } from '../../settings/SettingsControls';
import { StripeMethods } from '../../connections/StripeMethods';
import type { StoreConnection } from '../../connections/StoreConnections';

export const dynamic = 'force-dynamic';

// Counter › Payments › Settings.
//
// The WooPayments Settings screen has one job: decide which methods a shopper
// sees, and hold the browser-safe config the storefront needs to render them.
// That is what this is — the method toggles (StripeMethods, the same config the
// storefront charges against), the publishable keys, Apple Pay domain
// verification and wallet readiness. Secrets themselves live in Nexus and are
// entered only there; this is the operating view of them. Balance, payouts and
// the ledger are on the other tabs.

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
const PAYMENT_DEFAULTS: Payments = {
  stripePublishableKey: '',
  squareApplicationId: '',
  environment: 'live',
  appleDomainAssociation: '',
};

export default async function PaymentsSettingsPage() {
  const [connections, payments, wallets] = await Promise.all([
    apiGet<StoreConnection[]>('/api/connections').catch((): StoreConnection[] => []),
    apiGet<Payments>('/api/settings/payments').catch(() => PAYMENT_DEFAULTS),
    apiGet<WalletProvider[]>('/api/counter/wallets/providers').catch((): WalletProvider[] => []),
  ]);
  const stripeConnected = connections.some((c) => c.connected && c.id === 'stripe');

  return (
    <div>
      {!stripeConnected && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="l">No card processor connected</div>
          <p className="th-about-sub">
            Connect Stripe (or Square) in <a href={`${BASE_PATH}/settings/connections?tab=payments`}>Nexus</a> to take
            card payments and manage methods here. Until then checkout can only offer the mock method.
          </p>
        </div>
      )}

      {/* The WooPayments-equivalent method surface. */}
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
