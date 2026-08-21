import { apiGet } from '../../../lib/api';
import { BASE_PATH } from '../../../lib/session';
import { Field, SelectField, TextInput } from '../settings/SettingsControls';
import { StoreConnections, type StoreConnection } from './StoreConnections';
import { StripeMethods } from './StripeMethods';

export const dynamic = 'force-dynamic';

// Counter > Connections — a mini-Nexus, scoped to the store.
//
// Nexus is the full vault: every category, every provider, connect/test/rotate/
// revoke. That is the right home for credentials and it stays the only place
// one is entered. But a merchant standing in Counter asking "what am I
// actually wired up to — who takes the money, who ships the boxes, where do the
// products come from" should not have to go read a list of 79 providers across
// eight categories to find out.
//
// So this shows the three categories a STORE runs on — payments, fulfillment,
// ecommerce — and only what is CONNECTED. An empty category says it is empty
// rather than listing twenty things that are off; a wall of greyed-out
// providers reads as broken configuration instead of an unused option.
//
// Everything here is read-only by design. Duplicating the connect form would
// mean two places to rotate a key badly.

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

// A key this store ISSUED so a partner (a POD app, a bridge) can pull the
// catalog and push orders back. These are real, live connections — the ones the
// /api/connections list never showed, because that list only reads the outbound
// `connection` table. Shape mirrors GET /api/store-keys.
interface StoreKey {
  id: number | string;
  label: string;
  consumerKeyPreview?: string;
  scope?: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  createdAt?: string;
}

const PAYMENT_DEFAULTS: Payments = {
  stripePublishableKey: '',
  squareApplicationId: '',
  environment: 'live',
  appleDomainAssociation: '',
};

export default async function StoreConnectionsPage() {
  const [connections, payments, wallets, storeKeysResp] = await Promise.all([
    apiGet<StoreConnection[]>('/api/connections').catch((): StoreConnection[] => []),
    apiGet<Payments>('/api/settings/payments').catch(() => PAYMENT_DEFAULTS),
    apiGet<WalletProvider[]>('/api/counter/wallets/providers').catch((): WalletProvider[] => []),
    apiGet<{ keys: StoreKey[] }>('/api/store-keys').catch(() => ({ keys: [] as StoreKey[] })),
  ]);

  const live = connections.filter((c) => c.connected);
  const stripeConnected = live.some((c) => c.id === 'stripe');
  // Inbound partner keys are connections too. A revoked key is not.
  const storeKeys = (storeKeysResp.keys ?? []).filter((k) => !k.revokedAt);
  // Everything connected in Nexus (every category), plus inbound partner keys —
  // the same set StoreConnections now renders.
  const total = live.length + storeKeys.length;

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>Connections</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        What this store is wired up to — {total === 0 ? 'nothing yet' : `${total} connected`}. Credentials are entered
        in <a href={`${BASE_PATH}/settings/connections`}>Nexus</a>{' '}and only there; this is the store&apos;s view of them.
      </p>

      <StoreConnections connections={connections} />

      {/* Inbound partner keys — the connections the outbound list never showed.
          POD apps and bridges that pull this store's catalog and push orders. */}
      {storeKeys.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="l">Store keys — partners that read this store</div>
          <p className="th-about-sub">
            Print-on-demand and bridge apps you&apos;ve given a key so they can pull your catalog and push orders back.
            These are inbound connections — issued and revoked in{' '}
            <a href={`${BASE_PATH}/settings/connections`}>Nexus</a>.
          </p>
          {storeKeys.map((k) => (
            <div key={k.id} className="settings-toggle-row">
              <div className="settings-toggle-row-text">
                <span className="settings-toggle-row-label">{k.label}</span>
                <span className="settings-toggle-row-desc">
                  {k.consumerKeyPreview ? `${k.consumerKeyPreview} · ` : ''}
                  {k.scope === 'read' ? 'read only' : 'read / write'}
                  {k.lastUsedAt ? ` · last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : ' · not yet used'}
                </span>
              </div>
              <span className={'th-about-badge' + (k.lastUsedAt ? ' is-prod' : '')}>{k.lastUsedAt ? 'In use' : 'Idle'}</span>
            </div>
          ))}
        </div>
      )}

      {/* The WooPayments-equivalent method surface — per-method on/off for the
          configuration checkout uses. Only meaningful once Stripe is connected. */}
      <StripeMethods stripeConnected={stripeConnected} />

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="l">Add a connection</div>
        <p className="th-about-sub">
          Anything in the catalog, or a custom connector for something that isn&apos;t. Both live in Nexus, so a
          credential has exactly one home and one place to rotate it.
        </p>
        <p style={{ margin: 0, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a className="th-btn th-btn-primary" href={`${BASE_PATH}/settings/connections?tab=payments`}>
            Browse the catalog
          </a>
          <a className="th-btn" href={`${BASE_PATH}/settings/connections?tab=custom`}>
            Add a custom connector
          </a>
        </p>
      </div>

      {/* Payment-specific configuration that is NOT a credential, so it does
          not belong in the vault: values the browser legitimately receives. */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="l">Wallet readiness</div>
        <p className="th-about-sub">
          Apple Pay and Google Pay ride on whichever gateway processes the payment. Both parts are required: the
          gateway connected above, and its publishable key below.
        </p>
        {wallets.length === 0 && <p className="muted">Could not read wallet status — is the API running?</p>}
        {wallets.map((w) => (
          <div key={w.provider} className="settings-toggle-row">
            <div className="settings-toggle-row-text">
              <span className="settings-toggle-row-label">
                {w.provider === 'square' ? 'Square' : w.provider === 'stripe' ? 'Stripe' : w.provider}
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

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="l">Publishable keys</div>
        <p className="th-about-sub">
          Safe to expose — they are sent to every browser that loads checkout. The matching secret goes in Nexus.
        </p>
        <Field
          label="Stripe publishable key"
          help="Starts with pk_live_ or pk_test_. Stripe Dashboard → Developers → API keys."
        >
          <TextInput
            domain="payments"
            field="stripePublishableKey"
            initial={payments.stripePublishableKey}
            placeholder="pk_live_…"
          />
        </Field>
        <Field
          label="Square application ID"
          help="Starts with sq0idp-. Square Developer Dashboard → your application → Credentials. This is NOT the access token — that goes in Nexus."
        >
          <TextInput
            domain="payments"
            field="squareApplicationId"
            initial={payments.squareApplicationId}
            placeholder="sq0idp-…"
          />
        </Field>
        <Field label="Environment" help="Sandbox uses each provider's test mode. No real money moves.">
          <SelectField
            domain="payments"
            field="environment"
            initial={payments.environment}
            options={[
              ['live', 'Live'],
              ['sandbox', 'Sandbox'],
            ]}
          />
        </Field>
      </div>

      <div className="card">
        <div className="l">Apple Pay domain verification</div>
        <p className="th-about-sub">
          Apple fetches <code>/.well-known/apple-developer-merchantid-domain-association</code> from this exact domain
          over HTTPS before it will show the Apple Pay button. If it is missing, the button silently never appears —
          which is the usual reason Apple Pay &ldquo;doesn&rsquo;t work&rdquo;. Download the file from your payment
          provider or the Apple Developer portal and paste its contents here.
        </p>
        <Field label="Domain association file contents">
          <TextInput
            domain="payments"
            field="appleDomainAssociation"
            initial={payments.appleDomainAssociation}
            placeholder="7B227073704964223A…"
          />
        </Field>
        <p className="field-help">
          {payments.appleDomainAssociation
            ? 'Uploaded — the file is being served.'
            : 'Not set. Apple Pay will not appear until this is uploaded.'}
        </p>
      </div>
    </div>
  );
}
