'use client';
import { useState, useEffect} from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../../lib/session';

export interface ConnectionRow {
  id: string;
  name: string;
  category: 'ai' | 'messaging' | 'ecommerce' | 'payments' | 'apps' | 'fulfillment' | 'identity' | 'custom';
  authType: 'apikey' | 'oauth';
  credentialHint?: string;
  example?: string;
  note?: string;
  issuedBy?: 'provider' | 'your-store';
  connectsVia?: 'api-key' | 'oauth' | 'store-pull-woo' | 'store-pull-shopify';
  oauthCapable?: boolean;
  // Structured parts for key+secret-style providers (see nexusCatalog.ts) —
  // rendered as one input each, joined with `join` into the vault string.
  fields?: { label: string; secret?: boolean; optional?: boolean; example?: string }[];
  join?: string;
  connected: boolean;
  maskedPreview: string | null;
  status: string | null;
  connectedAt: string | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  testable: boolean;
}

/**
 * The ONE way this provider is connected.
 *
 * A provider can technically support several — Printful will read your store
 * with keys you issue, AND hand out an API token, AND run an OAuth app — and
 * the card used to render every applicable block stacked, with nothing saying
 * which one you actually want. Printful showed three forms and the one that
 * connects it to the store was the last of them, behind a button.
 *
 * 'store-pull' wins when present: if the partner connects BY READING THIS
 * STORE, then what it asks you for is the key pair this store issues, and the
 * provider's own token is for a different job entirely.
 */
export type ConnectMode = 'store-pull' | 'oauth' | 'api-key';

export function connectMode(r: { connectsVia?: string; authType?: string; oauthCapable?: boolean }): ConnectMode {
  if (r.connectsVia === 'store-pull-woo' || r.connectsVia === 'store-pull-shopify') return 'store-pull';
  // ONLY providers that are oauth-and-nothing-else lead with the button.
  // `oauthCapable` means "browser sign-in also works here" — an extra route
  // offered ALONGSIDE the real fields, never instead of them. Treating it as
  // the mode is what hid Printful's actual values behind an app-setup form.
  if (r.authType === 'oauth') return 'oauth';
  return 'api-key';
}

export interface AuditEntry {
  id: string;
  provider: string;
  action: string;
  actorId: string | null;
  detail: string | null;
  at: string;
}
export interface WebhookEntry {
  id: string;
  provider: string;
  event: string | null;
  payloadSummary: string | null;
  verified: boolean | null;
  receivedAt: string;
}

/**
 * What this provider actually wants, in one line, on the CARD.
 *
 * Every card used to read "API key" regardless of provider, so the grid gave
 * no way to tell that Gooten needs a Recipe ID and a Partner Billing Key while
 * Stripe needs one secret key — you had to open each one to find out, and if
 * you had the wrong value in hand you found out only after it failed.
 */
/** Drops the parenthetical guidance from a field label for compact display. */
function shortLabel(label: string): string {
  return label.replace(/\s*\(.*\)\s*$/, '').trim();
}

function credentialSummary(r: ConnectionRow): string {
  // A store-pull provider is not asking you for a key — YOU give it one. The
  // card used to advertise "API token (+1 optional)" for Printful, which is a
  // different integration entirely and sends you to the wrong page to fetch
  // the wrong value.
  if (r.connectsVia === 'store-pull-woo' || r.connectsVia === 'store-pull-shopify') {
    return 'Store key you issue';
  }
  if (r.fields?.length) {
    const required = r.fields.filter((f) => !f.optional).map((f) => shortLabel(f.label));
    const optional = r.fields.length - required.length;
    const labels = (required.length ? required : r.fields.map((f) => shortLabel(f.label))).join(' + ');
    return optional > 0 && required.length ? `${labels} (+${optional} optional)` : labels;
  }
  // Hints can be a full sentence — useful INSIDE the panel, but a paragraph on
  // a card just makes the grid unreadable, so the card gets the first clause.
  const hint = r.credentialHint ?? 'API key';
  return hint.length > 46 ? `${hint.split(/[—,.(]/)[0]!.trim()}…` : hint;
}

const SIGNATURE_PROVIDERS = ['github', 'stripe', 'slack'];

export const CATEGORY_LABELS: Record<ConnectionRow['category'], string> = {
  ai: 'AI tools',
  messaging: 'Messaging & APIs',
  ecommerce: 'Ecommerce platforms',
  payments: 'Payments',
  fulfillment: 'Fulfillment',
  identity: 'Customer sign-in',
  apps: 'External apps',
  custom: 'Custom',
};
const CATEGORY_ORDER: ConnectionRow['category'][] = ['ai', 'messaging', 'ecommerce', 'payments', 'fulfillment', 'identity', 'apps', 'custom'];

// Top-level tabs are the five provider CATEGORIES (one long stacked list
// buried everything), plus Vault and Activity.
type Tab = ConnectionRow['category'] | 'vault' | 'activity';
// Brand colorways for the provider icon tiles (1.x preview: "Icon colorways
// — provider-distinct, no logo files"); anything unlisted gets a stable
// hash-derived hue so every provider still reads distinct.
const ICON_COLORS: Record<string, { bg: string; fg?: string }> = {
  openai: { bg: '#10a37f' }, anthropic: { bg: '#cc785c' }, stripe: { bg: '#635bff' },
  square: { bg: '#000000' }, plaid: { bg: '#111111' }, paypal: { bg: '#0070ba' },
  notion: { bg: '#ffffff', fg: '#000' }, airtable: { bg: '#fcb400', fg: '#000' },
  slack: { bg: '#4a154b' }, linear: { bg: '#5e6ad2' }, zapier: { bg: '#ff4a00' },
  mailchimp: { bg: '#ffe01b', fg: '#000' }, sendgrid: { bg: '#1a82e2' }, twilio: { bg: '#f22f46' },
  github: { bg: '#181717' }, shopify: { bg: '#95bf47', fg: '#000' }, printful: { bg: '#ed4642' },
  printify: { bg: '#29ab51' }, gelato: { bg: '#ff5c39' }, contrado: { bg: '#1d1d1b' },
  tapstitch: { bg: '#111827' }, podpartner: { bg: '#2563eb' }, podplus: { bg: '#7c3aed' },
  gmail: { bg: '#ea4335' }, 'google-calendar': { bg: '#4285f4' }, 'google-sheets': { bg: '#0f9d58' },
  'google-drive': { bg: '#fbbc04', fg: '#000' },
};

export function iconColor(id: string): { bg: string; fg: string } {
  const known = ICON_COLORS[id];
  if (known) return { bg: known.bg, fg: known.fg ?? '#fff' };
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return { bg: `hsl(${h} 55% 42%)`, fg: '#fff' };
}

export function ConnectionsClient({
  initial,
  auditLog,
  webhookLog,
  oauthApps,
  webhookSecrets,
}: {
  initial: ConnectionRow[];
  auditLog: AuditEntry[];
  webhookLog: WebhookEntry[];
  oauthApps: Record<string, boolean>;
  webhookSecrets: Record<string, boolean>;
}) {
  const router = useRouter();
  // Tab survives full page loads (OAuth round-trips especially) via ?tab= —
  // router.refresh() alone preserves client state, but the provider redirect
  // back from an OAuth consent screen is a fresh document (audit finding #3).
  const [tab, setTabState] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'ai';
    const t = new URLSearchParams(window.location.search).get('tab');
    return t && ['ai', 'messaging', 'ecommerce', 'payments', 'fulfillment', 'identity', 'apps', 'custom', 'vault', 'activity'].includes(t) ? (t as Tab) : 'ai';
  });
  const setTab = (t: Tab) => {
    setTabState(t);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', t);
    window.history.replaceState(null, '', url.toString());
  };
  const rows = initial;
  // Mutations used to fail with zero feedback (no catch, no !res.ok branch —
  // audit finding #2); every handler now surfaces the backend's message here.
  const [actionError, setActionError] = useState('');
  // Held in component state ONLY: the secret is returned once and hashed
  // server-side, so a refresh losing it is correct, not a bug.
  const [storeKey, setStoreKey] = useState<{ consumerKey: string; consumerSecret: string } | null>(null);
  // The provider's connect screen asks for a store NAME, so the card hands the
  // real one over rather than making the operator go and look it up.
  const [storeName, setStoreName] = useState('');

  useEffect(() => {
    void fetch(`${BASE_PATH}/api/settings/site`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { siteName?: string } | null) => setStoreName(d?.siteName ?? ''))
      .catch(() => setStoreName(''));
  }, []);

  async function surface(res: Response): Promise<boolean> {
    if (res.ok) {
      setActionError('');
      return true;
    }
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    setActionError(body?.error?.message ?? `Request failed (${res.status})`);
    return false;
  }
  // Slide-over panel (1.x preview spec: "click any card → opens a slide-over
  // panel with the connection form; once connected, the same panel becomes
  // the management surface"). '__custom__' = the blank-card add-custom form.
  const [openId, setOpenId] = useState<string | null>(null);
  const [credential, setCredential] = useState('');
  // Per-part values for providers with structured fields (key+secret etc).
  const [fieldValues, setFieldValues] = useState<string[]>([]);

  // Compose the vault string from structured fields (trailing empty optional
  // parts trimmed so "token|loc|" stores as "token|loc").
  function composed(r: ConnectionRow): string {
    if (!r.fields) return credential;
    const vals = r.fields.map((_, i) => (fieldValues[i] ?? '').trim());
    while (vals.length && !vals[vals.length - 1]) vals.pop();
    return vals.join(r.join ?? '|');
  }
  function fieldsReady(r: ConnectionRow): boolean {
    if (!r.fields) return credential.trim().length > 0;
    return r.fields.every((f, i) => f.optional || (fieldValues[i] ?? '').trim().length > 0);
  }
  const [customSlug, setCustomSlug] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [webhookSecretOpen, setWebhookSecretOpen] = useState<string | null>(null);
  const [webhookSecretValue, setWebhookSecretValue] = useState('');

  async function saveWebhookSecret(provider: string): Promise<void> {
    if (!webhookSecretValue.trim()) return;
    setBusy(provider);
    try {
      const res = await fetch(`${BASE_PATH}/api/connections/${provider}/webhook-secret`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: webhookSecretValue }),
      });
      if (await surface(res)) {
        setWebhookSecretOpen(null);
        setWebhookSecretValue('');
        router.refresh();
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(null);
    }
  }

  function openPanel(id: string): void {
    setOpenId(openId === id ? null : id);
    setCredential('');
    setFieldValues([]);
    setClientId('');
    setClientSecret('');
    setCustomSlug('');
    setActionError('');
  }

  async function connect(id: string, value?: string): Promise<void> {
    const cred = value ?? credential;
    if (!cred.trim()) return;
    setBusy(id);
    try {
      const res = await fetch(`${BASE_PATH}/api/connections/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credential: cred }),
      });
      if (await surface(res)) {
        setCredential('');
        setFieldValues([]);
        router.refresh();
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(null);
    }
  }

  async function saveOAuthApp(id: string): Promise<void> {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setBusy(id);
    try {
      const res = await fetch(`${BASE_PATH}/api/connections/${id}/oauth/app`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret }),
      });
      if (await surface(res)) {
        setClientId('');
        setClientSecret('');
        router.refresh();
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(id: string): Promise<void> {
    setBusy(id);
    try {
      const res = await fetch(`${BASE_PATH}/api/connections/${id}`, { method: 'DELETE' });
      if (await surface(res)) router.refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(null);
    }
  }

  async function test(id: string): Promise<void> {
    setBusy(id);
    try {
      const res = await fetch(`${BASE_PATH}/api/connections/${id}/test`, { method: 'POST' });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; detail?: string; error?: { message?: string } } | null;
      setTestResult((prev) => ({ ...prev, [id]: body?.detail ?? body?.error?.message ?? 'Test failed.' }));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const connectedRows = rows.filter((r) => r.connected);

  const needsAttention = connectedRows.filter((r) => r.lastTestOk === false).length;

  // The detail view lives INSIDE the card that opens it.
  //
  // It used to be a fixed slide-over: opening one covered the grid, so you
  // lost sight of what you were configuring and of everything else's state.
  // Expanding in place keeps the card you clicked where your eye already is,
  // and the surrounding cards stay readable.
  /**
   * Issues a store key for a partner that connects by READING this store.
   *
   * The secret comes back once and is held in component state only — a
   * refresh loses it, exactly as it should, because it is never stored
   * recoverably on the server either.
   */
  async function issueStoreKey(label: string): Promise<void> {
    setActionError('');
    try {
      const res = await fetch(`${BASE_PATH}/api/store-keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label, scope: 'read_write' }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? 'Could not create a store key.');
      setStoreKey({ consumerKey: body.consumerKey, consumerSecret: body.consumerSecret });
      // Straight into the boxes: these three ARE the credential, and making
      // someone copy them from a panel into fields directly below it is busy
      // work. Paste the same pair into the provider.
      setFieldValues([
        typeof window === 'undefined' ? '' : window.location.origin,
        body.consumerKey,
        body.consumerSecret,
      ]);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  function renderDetail(openId: string) {
    const r = openId === '__custom__' ? null : rows.find((x) => x.id === openId);
    if (openId !== '__custom__' && !r) return null;
    const ic = r ? iconColor(r.id) : iconColor('custom');
    return (
      <>
              {/* Provider header renders ONLY for the custom-connector form.
                  For a real provider the card directly above already shows the
                  icon, name and status — repeating them inline just pushes the
                  fields the user actually came for further down. */}
              <div style={{ display: r ? 'none' : 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                <span style={{ width: 40, height: 40, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, background: ic.bg, color: ic.fg }}>
                  {r ? r.name.slice(0, 2) : '+'}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{r ? r.name : 'Custom connector'}</div>
                  <div style={{ fontSize: 11, color: 'var(--th-muted)' }}>
                    {r ? (r.connected ? `Connected${r.connectedAt ? ' · ' + new Date(r.connectedAt).toLocaleDateString() : ''}` : 'Not connected') : 'Wire any API into the vault'}
                  </div>
                </div>
                <button type="button" className="ghost" onClick={() => setOpenId(null)} aria-label="Close" style={{ fontSize: 16, lineHeight: 1 }}>×</button>
              </div>

              {actionError && <p style={{ color: 'var(--th-danger, #ef4444)', fontSize: 12, margin: 'var(--th-space-8) 0' }}>{actionError}</p>}

              {/* Custom-create mode */}
              {!r && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--th-muted)' }}>Connector name
                    <input value={customSlug} onChange={(e) => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="pod-partner" style={{ width: '100%', marginTop: 4 }} />
                  </label>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--th-muted)' }}>Credential
                    <input type="password" value={credential} onChange={(e) => setCredential(e.target.value)} placeholder='API key — or "key|https://test-url"' style={{ width: '100%', marginTop: 4 }} />
                  </label>
                  <button type="button" disabled={!customSlug.trim() || !credential.trim() || busy !== null} onClick={() => void connect(`custom-${customSlug.trim()}`)}>
                    Add connector
                  </button>
                  <p style={{ fontSize: 10, color: 'var(--th-muted)', margin: 0 }}>
                    Same encryption, audit log, and webhook receiver as catalog providers. Append <code>|https://…</code> to enable Test.
                  </p>
                </div>
              )}

              {/* OAuth providers */}
              {r && connectMode(r) === 'oauth' && !r.connected && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
                  {/* The button is shown ONLY when an OAuth app actually
                      exists for this provider. Showing it unconditionally is
                      what made "Sign in with Square" bounce straight back to
                      the admin: with no app the backend 409s and the proxy
                      redirects home, which reads as being dumped at a login
                      screen. A button that cannot work must not be offered. */}
                  {oauthApps[r.id] ? (
                    <a href={`${BASE_PATH}/api/connections/${r.id}/oauth/start?tab=${r.category}`} className="button" style={{ textAlign: 'center' }}>
                      Sign in with {r.name}
                    </a>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <p style={{ fontSize: 11, color: 'var(--th-muted)', margin: 0, lineHeight: 1.5 }}>
                        One-time setup before &ldquo;Sign in with {r.name}&rdquo; can work: create an app in {r.name}&apos;s
                        developer console and paste its credentials here. Give it this redirect URL:
                      </p>
                      <input
                        readOnly
                        onFocus={(e) => e.currentTarget.select()}
                        value={typeof window === 'undefined' ? '' : `${window.location.origin}${BASE_PATH}/api/connections/${r.id}/oauth/callback`}
                        style={{ fontFamily: 'var(--th-font-mono)', fontSize: 11 }}
                      />
                      <input type="text" placeholder="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} />
                      <input type="password" placeholder="Client secret" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
                      <button type="button" onClick={() => void saveOAuthApp(r.id)} disabled={busy === r.id || !clientId.trim() || !clientSecret.trim()}>
                        Save and enable sign-in
                      </button>
                    </div>
                  )}
                  <div style={{ borderTop: '1px solid var(--th-line)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <p style={{ fontSize: 11, color: 'var(--th-muted)', margin: 0 }}>
                      Or paste {r.fields && r.fields.length > 1 ? 'the keys' : 'a key'} instead:
                    </p>
                    {/* The provider's REAL fields, not a generic token box —
                        authorizing by web is an alternative to these, not a
                        reason to stop naming them. */}
                    {/* These providers authenticate with a key THIS store
                        issues, so the card can mint one and fill the boxes.
                        Without this there is no way to get a valid pair on a
                        fresh install — which is exactly what happened: a key
                        from another install 401s, correctly. */}
                    {r.category === 'fulfillment' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" className="th-btn" onClick={() => void issueStoreKey(`${r.name} store key`)}>
                          Issue a store key
                        </button>
                        <span style={{ fontSize: 11, color: 'var(--th-muted)' }}>
                          Fills the boxes below. Paste the same pair into {r.name}.
                        </span>
                      </div>
                    )}
                    {r.fields && r.fields.length > 1 && (
                      r.fields.map((f, i) => (
                        <label key={f.label} style={{ fontSize: 11, fontWeight: 600, color: 'var(--th-muted)' }}>
                          {f.label}{f.optional ? ' (optional)' : ''}
                          <input
                            type={f.secret ? 'password' : 'text'}
                            value={fieldValues[i] ?? ''}
                            onChange={(e) => setFieldValues((prev) => { const next = [...prev]; next[i] = e.target.value; return next; })}
                            style={{ width: '100%', marginTop: 4 }}
                          />
                        </label>
                      ))
                    )}
                    <input type="password" placeholder={r.credentialHint ?? 'Personal access token'} value={credential} onChange={(e) => setCredential(e.target.value)} />
                    <button type="button" onClick={() => void connect(r.id)} disabled={busy === r.id || !credential.trim()}>Connect with token</button>
                  </div>
                </div>
              )}

              {/* API-key providers, not yet connected. Providers with
                  structured auth (key+secret pairs, token+location, …) render
                  one input per part; single-value providers get one field. */}
              {/* Partner reads THIS store: it needs a key we issue, not one it
                  issues. Asking for a provider key here is what made these
                  impossible to connect. */}
              {/* Browser sign-in as an EXTRA route, for providers that support it
                  but are not oauth-only. It sits AFTER the provider's real
                  fields, because those are what most people came here to fill
                  in — and the one-time app setup hides in a disclosure instead
                  of dominating the card the way it did on Printful. */}
              {r && r.oauthCapable && r.authType !== 'oauth' && !r.connected && (
                <div style={{ marginTop: 14, borderTop: '1px solid var(--th-line)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {oauthApps[r.id] ? (
                    <>
                      <p style={{ fontSize: 11, color: 'var(--th-muted)', margin: 0 }}>Or authorise in the browser instead:</p>
                      <a href={`${BASE_PATH}/api/connections/${r.id}/oauth/start?tab=${r.category}`} className="th-btn" style={{ textAlign: 'center' }}>
                        Sign in with {r.name}
                      </a>
                    </>
                  ) : (
                    <details>
                      <summary style={{ fontSize: 11, color: 'var(--th-muted)', cursor: 'pointer' }}>
                        Set up &ldquo;Sign in with {r.name}&rdquo; (one time, optional)
                      </summary>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                        <p style={{ fontSize: 11, color: 'var(--th-muted)', margin: 0, lineHeight: 1.5 }}>
                          Create an app in {r.name}&apos;s developer console and paste its credentials here. Give it this
                          redirect URL:
                        </p>
                        <input readOnly onFocus={(e) => e.currentTarget.select()}
                          value={typeof window === 'undefined' ? '' : `${window.location.origin}${BASE_PATH}/api/connections/${r.id}/oauth/callback`}
                          style={{ fontFamily: 'var(--th-font-mono)', fontSize: 11 }} />
                        <input type="text" placeholder="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} />
                        <input type="password" placeholder="Client secret" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
                        <button type="button" className="th-btn" onClick={() => void saveOAuthApp(r.id)} disabled={busy === r.id || !clientId.trim() || !clientSecret.trim()}>
                          Save and enable sign-in
                        </button>
                      </div>
                    </details>
                  )}
                </div>
              )}

              {r && connectMode(r) === 'store-pull' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
                  {/* The step nobody can guess: these partners present a LIST
                      of platforms (Shopify / Woo / Wix / Etsy …) and you have
                      to pick WooCommerce. Picking Shopify sends them into
                      Shopify's own OAuth against a myshopify.com domain, which
                      no self-hosted store can satisfy — it fails with an error
                      about the store URL and looks like a credential problem. */}
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--th-muted)', lineHeight: 1.6 }}>
                    In {r.name}, choose <strong>WooCommerce</strong> from its list of platforms — not Shopify. Shopify&apos;s
                    flow requires a myshopify.com domain and cannot be satisfied by a self-hosted store. Then paste the
                    three values below.
                  </p>
                  {!storeKey ? (
                    <button type="button" className="th-btn th-btn-primary" onClick={() => void issueStoreKey(`${r.name} store key`)}>
                      Generate the values {r.name} asks for
                    </button>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {/* These are the EXACT fields the provider's own connect
                          screen asks for, in its order. Printful wants a store
                          name, a website, a consumer key and a consumer secret;
                          handing over an API token instead — which is what this
                          card used to lead with — connects nothing. */}
                      {([
                        ['Store name', storeName || 'Your store'],
                        ['Website', typeof window === 'undefined' ? '' : window.location.origin],
                        ['Consumer key', storeKey.consumerKey],
                        ['Consumer secret', storeKey.consumerSecret],
                      ] as [string, string][]).map(([label, value]) => (
                        <label key={label} style={{ fontSize: 11, fontWeight: 600, color: 'var(--th-muted)' }}>
                          {label}
                          <span style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                            <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, fontFamily: 'var(--th-font-mono)', fontSize: 11 }} />
                            <button type="button" className="th-btn" style={{ fontSize: 11 }}
                              onClick={() => void navigator.clipboard?.writeText(value)}>Copy</button>
                          </span>
                        </label>
                      ))}
                      <p style={{ margin: 0, fontSize: 10, color: 'var(--th-muted)' }}>
                        The secret is shown once. Copy it now — it is hashed on the server and cannot be shown again.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {r && connectMode(r) === 'api-key' && !r.connected && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
                  {/* Where the values come from, shown BEFORE the boxes. Every
                      provider used to render one identical "API key" field, so
                      nothing on screen told you which value it wanted or who
                      issues it — the two things you need in order to go and
                      fetch the right thing. */}
                  {(r.credentialHint || r.issuedBy === 'your-store') && (
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--th-muted)', lineHeight: 1.5 }}>
                      {r.issuedBy === 'your-store'
                        ? `${r.name} reads your store, so these are issued by YOUR store, not by ${r.name}. `
                        : ''}
                      {r.credentialHint}
                    </p>
                  )}
                  {r.fields ? (
                    r.fields.map((f, i) => (
                      <label key={f.label} style={{ fontSize: 11, fontWeight: 600, color: 'var(--th-muted)' }}>
                        {f.label}{f.optional ? ' (optional)' : ''}
                        <input
                          type={f.secret ? 'password' : 'text'}
                          value={fieldValues[i] ?? ''}
                          onChange={(e) => setFieldValues((prev) => { const next = [...prev]; next[i] = e.target.value; return next; })}
                          placeholder=""
                          style={{ width: '100%', marginTop: 4 }}
                          autoFocus={i === 0}
                        />
                        {f.example && (
                          <span style={{ display: 'block', marginTop: 3, fontSize: 10, fontWeight: 400, color: 'var(--th-muted)' }}>
                            e.g. {f.example}
                          </span>
                        )}
                      </label>
                    ))
                  ) : (
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--th-muted)' }}>{r.credentialHint ?? 'API key'}
                      <input type="password" value={credential} onChange={(e) => setCredential(e.target.value)} placeholder="" style={{ width: '100%', marginTop: 4 }} autoFocus />
                    </label>
                  )}
                  {r.note && <p style={{ margin: 0, fontSize: 11, color: 'var(--th-muted)', lineHeight: 1.5 }}>{r.note}</p>}
                  <button type="button" onClick={() => void connect(r.id, composed(r))} disabled={busy === r.id || !fieldsReady(r)}>Connect</button>
                  {r.testable && <p style={{ fontSize: 10, color: 'var(--th-muted)', margin: 0 }}>Live test available once connected — verifies the key against {r.name}'s real API.</p>}
                </div>
              )}

              {/* Connected: management surface */}
              {r && r.connected && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
                  <div style={{ background: 'var(--th-surface-2, rgba(0,0,0,.03))', border: '1px solid var(--th-line)', borderRadius: 10, padding: 12, fontFamily: 'var(--th-font-mono)', fontSize: 12 }}>
                    {r.maskedPreview}
                  </div>
                  {r.lastTestedAt && (
                    <p style={{ fontSize: 11, color: r.lastTestOk ? 'var(--th-success, #10b981)' : 'var(--th-danger, #ef4444)', margin: 0 }}>
                      Last test: {r.lastTestOk ? 'OK' : 'failed'} · {new Date(r.lastTestedAt).toLocaleString()}
                    </p>
                  )}
                  {testResult[r.id] && <p style={{ fontSize: 11, color: 'var(--th-muted)', margin: 0 }}>{testResult[r.id]}</p>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    {r.testable && (
                      <button type="button" onClick={() => void test(r.id)} disabled={busy === r.id} style={{ flex: 1 }}>
                        {busy === r.id ? 'Testing…' : 'Test connection'}
                      </button>
                    )}
                    <button type="button" className="ghost" onClick={() => void disconnect(r.id)} disabled={busy === r.id} style={{ flex: 1 }}>Disconnect</button>
                  </div>
                  <div style={{ borderTop: '1px solid var(--th-line)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <p style={{ fontSize: 11, color: 'var(--th-muted)', margin: 0 }}>Rotate credential:</p>
                    {r.fields ? (
                      r.fields.map((f, i) => (
                        <input
                          key={f.label}
                          type={f.secret ? 'password' : 'text'}
                          placeholder={`${f.label}${f.optional ? ' (optional)' : ''}`}
                          value={fieldValues[i] ?? ''}
                          onChange={(e) => setFieldValues((prev) => { const next = [...prev]; next[i] = e.target.value; return next; })}
                        />
                      ))
                    ) : (
                      <input type="password" placeholder={r.credentialHint ?? 'New API key'} value={credential} onChange={(e) => setCredential(e.target.value)} />
                    )}
                    <button type="button" className="ghost" onClick={() => void connect(r.id, composed(r))} disabled={busy === r.id || !fieldsReady(r)}>Update key</button>
                  </div>
                  <p style={{ fontSize: 10, color: 'var(--th-muted)', margin: 0 }}>
                    Inbound webhook: <code>/api/webhooks/connections/{r.id}</code>
                  </p>
                </div>
              )}
      </>
    );
  }

  return (
    <div>
      {actionError && <div className="notice">{actionError}</div>}
      {/* Page-header status strip (preview V5): mirrors the dashboard card. */}
      <p style={{ margin: '0 0 var(--th-space-12)', fontSize: 'var(--th-fs-sm)', color: 'var(--th-muted)' }}>
        <strong style={{ color: 'var(--th-success, #10b981)' }}>{connectedRows.length}</strong> connected
        {needsAttention > 0 && <> · <strong style={{ color: 'var(--th-danger, #ef4444)' }}>{needsAttention}</strong> action needed</>}
        {' · '}{rows.length} total
      </p>
      <div style={{ display: 'flex', gap: 'var(--th-space-16)', borderBottom: '1px solid var(--th-line)', marginBottom: 'var(--th-space-16)', flexWrap: 'wrap' }}>
        {([...CATEGORY_ORDER, 'vault', 'activity'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className="ghost"
            style={{
              border: 'none',
              borderRadius: 0,
              background: 'transparent',
              padding: 'var(--th-space-8) 0',
              borderBottom: tab === t ? '2px solid var(--th-accent)' : '2px solid transparent',
              color: tab === t ? 'var(--th-ink)' : 'var(--th-muted)',
              fontWeight: tab === t ? 600 : 500,
            }}
          >
            {t === 'vault'
              ? `Vault (${connectedRows.length})`
              : t === 'activity'
                ? 'Activity'
                : `${CATEGORY_LABELS[t as ConnectionRow['category']]} (${rows.filter((r) => r.category === t).length})`}
          </button>
        ))}
      </div>

      {CATEGORY_ORDER.filter((cat) => cat === tab).map((cat) => (
        <div key={cat} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
          {rows
            .filter((r) => r.category === cat)
            .map((r) => {
              const ic = iconColor(r.id);
              const statusColor = r.connected ? (r.lastTestOk === false ? 'var(--th-danger, #ef4444)' : 'var(--th-success, #10b981)') : 'var(--th-muted)';
              const expanded = openId === r.id;
              return (
                <div
                  key={r.id}
                  style={{
                    // An expanded card takes the full row so the form has room;
                    // collapsed cards keep their normal grid cell.
                    gridColumn: expanded ? '1 / -1' : 'auto',
                    display: 'flex', flexDirection: 'column',
                  }}
                >
                <button
                  type="button"
                  onClick={() => (expanded ? setOpenId(null) : openPanel(r.id))}
                  style={{
                    position: 'relative', textAlign: 'left', padding: expanded ? '12px 18px' : 18, minHeight: expanded ? 0 : 150,
                    background: r.connected ? 'linear-gradient(180deg, rgba(16,185,129,.05), var(--th-surface))' : 'var(--th-surface)',
                    border: r.connected ? '1px solid rgba(16,185,129,.3)' : '1px solid var(--th-line)',
                    borderRadius: expanded ? '14px 14px 0 0' : 14, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6,
                    transition: 'transform .15s ease, box-shadow .15s ease, border-color .15s ease',
                    fontFamily: 'inherit', color: 'var(--th-ink)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 10px 28px rgba(0,0,0,.10)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
                >
                  <span style={{ position: 'absolute', top: 14, right: 14, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, letterSpacing: '.04em', textTransform: 'uppercase', color: statusColor }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
                    {r.connected ? (r.lastTestOk === false ? 'error' : 'connected') : 'off'}
                  </span>
                  {/* Expanded: one compact row (icon + name + shape). The tall
                      card above an open form is dead space. */}
                  <span style={{ display: expanded ? 'flex' : 'block', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: expanded ? 28 : 40, height: expanded ? 28 : 40, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: expanded ? 11 : 14, letterSpacing: '-.02em', background: ic.bg, color: ic.fg, marginBottom: expanded ? 0 : 6 }}>
                      {r.name.slice(0, 2)}
                    </span>
                    <span style={{ display: expanded ? 'inline' : 'block', fontSize: 14, fontWeight: 600 }}>{r.name}</span>
                    <span style={{ display: expanded ? 'inline' : 'block', fontSize: 11, color: 'var(--th-muted)' }}>
                      {r.connected ? r.maskedPreview : r.authType === 'oauth' ? (oauthApps[r.id] ? 'OAuth ready' : 'OAuth · needs app setup') : credentialSummary(r)}
                    </span>
                  </span>
                  <span style={{ display: expanded ? 'none' : 'flex', marginTop: 'auto', paddingTop: 10, borderTop: '1px solid var(--th-line)', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, fontWeight: 600 }}>
                    <span>{r.connected ? 'Manage' : 'Connect'} {expanded ? '▾' : '→'}</span>
                    {r.testable && <span style={{ fontSize: 9, color: 'var(--th-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>live test</span>}
                  </span>
                </button>
                {expanded && (
                  <div
                    style={{
                      border: '1px solid var(--th-line)', borderTop: 'none',
                      borderRadius: '0 0 14px 14px', padding: 18,
                      background: 'var(--th-surface)',
                    }}
                  >
                    {renderDetail(r.id)}
                  </div>
                )}
                </div>
              );
            })}
          {/* "+ Add custom" blank card — in every section, per the 1.x preview spec. */}
          <button
            type="button"
            onClick={() => (openId === '__custom__' ? setOpenId(null) : openPanel('__custom__'))}
            style={{
              minHeight: 150, padding: 18, background: 'transparent', border: '1px dashed var(--th-line)',
              borderRadius: 14, cursor: 'pointer', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--th-muted)', fontFamily: 'inherit',
            }}
          >
            <span style={{ fontSize: 22, lineHeight: 1 }}>+</span>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Add custom connector</span>
            <span style={{ fontSize: 10 }}>Any API into the vault</span>
          </button>
          {openId === '__custom__' && (
            <div style={{ gridColumn: '1 / -1', border: '1px solid var(--th-line)', borderRadius: 14, padding: 18, background: 'var(--th-surface)' }}>
              {renderDetail('__custom__')}
            </div>
          )}
        </div>
      ))}


      {tab === 'vault' && (
        <div className="settings-group">
          <h3 className="settings-group-title">Vault</h3>
          <p className="settings-group-desc">Every connected credential — masked, never the real value.</p>
          {/* 4-up stat strip (preview cx-stat pattern). */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, margin: 'var(--th-space-12) 0 var(--th-space-16)' }}>
            {[
              { label: 'Stored', value: connectedRows.length, color: 'var(--th-ink)' },
              { label: 'Tested OK', value: connectedRows.filter((r) => r.lastTestOk === true).length, color: 'var(--th-success, #10b981)' },
              { label: 'Failing', value: connectedRows.filter((r) => r.lastTestOk === false).length, color: 'var(--th-danger, #ef4444)' },
              { label: 'Untested', value: connectedRows.filter((r) => r.lastTestOk === null).length, color: 'var(--th-muted)' },
            ].map((s) => (
              <div key={s.label} style={{ border: '1px solid var(--th-line)', borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--th-muted)' }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
              </div>
            ))}
          </div>
          {connectedRows.length === 0 ? (
            <div className="settings-empty-state">Nothing connected yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--th-fs-sm)' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--th-line)' }}>
                  <th style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' }}>Provider</th>
                  <th style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' }}>Category</th>
                  <th style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' }}>Credential</th>
                  <th style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' }}>Connected</th>
                  <th style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' }}>Last test</th>
                </tr>
              </thead>
              <tbody>
                {connectedRows.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--th-line)' }}>
                    <td style={{ padding: 'var(--th-space-8) var(--th-space-6)' }}>{r.name}</td>
                    <td style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)' }}>{CATEGORY_LABELS[r.category]}</td>
                    <td style={{ padding: 'var(--th-space-8) var(--th-space-6)', fontFamily: 'var(--th-font-mono)' }}>{r.maskedPreview}</td>
                    <td style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)' }}>{r.connectedAt ? new Date(r.connectedAt).toLocaleString() : '—'}</td>
                    <td style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)' }}>
                      {r.lastTestedAt ? `${r.lastTestOk ? 'OK' : 'failed'} · ${new Date(r.lastTestedAt).toLocaleString()}` : r.testable ? 'not tested' : 'no test wired'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'activity' && (
        <>
          <div className="settings-group">
            <h3 className="settings-group-title">Audit log</h3>
            <p className="settings-group-desc">Connect / disconnect / test actions, most recent first.</p>
            {auditLog.length === 0 ? (
              <div className="settings-empty-state">No activity yet.</div>
            ) : (
              <ul className="dash-list">
                {auditLog.map((e) => (
                  <li key={e.id}>
                    <span>
                      <strong>{e.provider}</strong> — {e.action}
                      {e.detail ? ` (${e.detail})` : ''}
                    </span>{' '}
                    <span className="muted">{new Date(e.at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="settings-group">
            <h3 className="settings-group-title">Webhooks &amp; outbound key</h3>
            <p className="settings-group-desc">
              Inbound: <code>{'{your-api-host}/api/webhooks/connections/:provider'}</code>. Signature verification is real for GitHub,
              Stripe, and Slack once a secret is set below — a configured secret that fails verification is rejected (401), not just
              logged. Every other provider logs receipt without a cryptographic verdict; business logic per provider is still real work
              to land. Outbound: this site&apos;s own API key is managed under <a href={`${BASE_PATH}/account`}>Account</a>.
            </p>
            <div style={{ display: 'flex', gap: 'var(--th-space-8)', flexWrap: 'wrap', marginBottom: 'var(--th-space-10)' }}>
              {SIGNATURE_PROVIDERS.map((p) => (
                <div key={p}>
                  <button
                    type="button"
                    className="ghost"
                    style={{ fontSize: 11 }}
                    onClick={() => {
                      setWebhookSecretOpen(webhookSecretOpen === p ? null : p);
                      setWebhookSecretValue('');
                    }}
                  >
                    {p} {webhookSecrets[p] ? '✓ secret set' : '— set secret'}
                  </button>
                  {webhookSecretOpen === p && (
                    <div style={{ display: 'flex', gap: 'var(--th-space-6)', marginTop: 'var(--th-space-6)' }}>
                      <input
                        type="password"
                        placeholder="Signing secret"
                        value={webhookSecretValue}
                        onChange={(e) => setWebhookSecretValue(e.target.value)}
                        style={{ padding: 'var(--th-space-6) var(--th-space-8)', border: '1px solid var(--th-line)', borderRadius: 'var(--th-r)', fontSize: 12 }}
                      />
                      <button type="button" onClick={() => void saveWebhookSecret(p)} disabled={busy === p || !webhookSecretValue.trim()} style={{ fontSize: 11 }}>
                        Save
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {webhookLog.length === 0 ? (
              <div className="settings-empty-state">No webhook activity yet.</div>
            ) : (
              <ul className="dash-list">
                {webhookLog.map((e) => (
                  <li key={e.id}>
                    <span>
                      <strong>{e.provider}</strong>
                      {e.event ? ` — ${e.event}` : ''}
                      {e.verified === true && <span className="pill pill-ok" style={{ marginLeft: 6 }}>verified</span>}
                      {e.verified === false && <span className="pill pill-failed" style={{ marginLeft: 6 }}>unverified</span>}
                    </span>{' '}
                    <span className="muted">{new Date(e.receivedAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
