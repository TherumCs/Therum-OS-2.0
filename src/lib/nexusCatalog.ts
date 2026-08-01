// The Connections hub's real provider catalog — 5 categories, 67 providers.
// Started as the inventory's exact 63 (AI 13, Messaging 12, Ecommerce 8,
// Payments 12, Apps 18); the Google family (Gmail, Calendar, Sheets) was
// added 2026-07-23 by direction, bringing Messaging to 13 and Apps to 20.
// OAuth providers: Slack, GitHub, and the four Google services (all four
// share one Google Cloud OAuth app — same client id/secret, different
// scopes). Everything else is a pasted API key.
export type ConnectionCategory = 'ai' | 'messaging' | 'ecommerce' | 'payments' | 'apps' | 'fulfillment' | 'identity' | 'hosting' | 'custom';
export type AuthType = 'apikey' | 'oauth';

// CREDENTIAL SHAPES (researched 2026-07-28).
//
// Every provider used to render one identical "API key" box. That is simply
// wrong for most of them: Gooten needs a Recipe ID AND a Partner Billing Key,
// Zendesk needs a subdomain AND an email AND a token, and Ollama needs a URL
// rather than a key at all. A single box means the merchant guesses, pastes
// the wrong half, and gets a 401 that blames their key.
//
// Each entry below now declares the values that provider's own documentation
// asks for. Where a shape could NOT be confirmed from public docs, the hint
// says so rather than inventing plausible field names — an invented label is
// worse than a generic one, because it looks authoritative.
//
// PRINTFUL, specifically: its own API takes a Private Token (Developer Portal
// > Your tokens). The "consumer key and secret" pair people see is the
// WooCommerce REST credential that Printful asks for when it connects to a
// WooCommerce store — issued by the STORE, not by Printful. Counter is not
// WooCommerce, so the private token is the right value here.

export interface CatalogProvider {
  id: string;
  name: string;
  category: ConnectionCategory;
  authType: AuthType;
  // Set only for providers whose real API needs 2 values (e.g. Twilio's
  // Account SID + Auth Token) — the single credential field accepts
  // "FIRST:SECOND" for these, split by the tester. Undefined means a plain
  // single value (API key or OAuth-fallback personal access token).
  credentialHint?: string;
  // Structured credential fields (2026-07-24): providers whose real auth is
  // key+secret (or more) declare each part so the connect panel renders one
  // input per part. Values are joined with `join` into the single vault
  // string — matching EXACTLY what that provider's tester already splits
  // (':' for the pair testers, '|' for Square/custom). `secret` masks the
  // input; `optional` parts may be left blank (trailing separators trimmed).
  fields?: { label: string; secret?: boolean; optional?: boolean; pattern?: string; example?: string }[];
  /** Pattern for single-value providers (those with no `fields`). */
  pattern?: string;
  example?: string;
  join?: string;
  /**
   * WHO ISSUES the values above.
   *
   * 'provider'   — the provider generates them; you copy them out of their
   *                dashboard. This is the common case.
   * 'your-store' — YOUR store generates them and the provider consumes them,
   *                because that integration works by the provider READING
   *                your store rather than your store calling the provider.
   *
   * This distinction is the whole reason Printful looks confusing: Printful's
   * own API takes a token it issues, but Printful's legacy WooCommerce store
   * connection asks you to paste a ck_/cs_ pair that WOOCOMMERCE issued. Same
   * vendor, opposite direction, completely different value. Without this field
   * the connect screen cannot tell you where to go and get the thing.
   */
  issuedBy?: 'provider' | 'your-store';
  /**
   * HOW this provider connects, so the connect screen can work it out rather
   * than the operator having to.
   *
   * 'api-key'        — you paste a key the provider issued. The common case.
   * 'oauth'          — a consent button; nothing to paste.
   * 'store-pull-woo' — the provider connects by READING your store against a
   *                    WooCommerce-shaped API, so what it needs is a consumer
   *                    key/secret THIS store issues (see wooCompat.ts).
   * 'store-pull-shopify' — same, but the partner only speaks Shopify.
   *
   * Getting this wrong is what made Printful impossible to connect: the panel
   * asked for a key the provider would issue, when the provider was waiting to
   * be handed one of ours.
   */
  connectsVia?: 'api-key' | 'oauth' | 'store-pull-woo' | 'store-pull-shopify';
  /** Extra guidance shown under the fields — the "where do I find this" line. */
  note?: string;
}

export const CATEGORY_LABELS: Record<ConnectionCategory, string> = {
  ai: 'AI tools',
  messaging: 'Messaging & APIs',
  ecommerce: 'Ecommerce platforms',
  payments: 'Payments',
  fulfillment: 'Fulfillment',
  identity: 'Customer sign-in',
  hosting: 'Hosting & infrastructure',
  apps: 'External apps',
  custom: 'Custom',
};

export const nexusCatalog: CatalogProvider[] = [
  // AI tools (13)
  { id: 'anthropic', name: 'Anthropic', category: 'ai', authType: 'apikey', issuedBy: 'provider', credentialHint: 'API key, starts with sk-ant-', fields: [{ label: 'API Key', secret: true, pattern: '^sk-ant-', example: 'sk-ant-api03-…' }] },
  { id: 'openai', name: 'OpenAI', category: 'ai', authType: 'apikey', issuedBy: 'provider', credentialHint: 'API key, starts with sk-', fields: [{ label: 'API Key', secret: true, pattern: '^sk-', example: 'sk-proj-…' }] },
  { id: 'gemini', name: 'Gemini', category: 'ai', authType: 'apikey', issuedBy: 'provider', credentialHint: 'API key from Google AI Studio, starts with AIza', fields: [{ label: 'API Key', secret: true, pattern: '^AIza', example: 'AIzaSy…' }] },
  { id: 'grok', name: 'Grok', category: 'ai', authType: 'apikey', issuedBy: 'provider', credentialHint: 'xAI API key, starts with xai-', fields: [{ label: 'API Key', secret: true, pattern: '^xai-', example: 'xai-…' }] },
  { id: 'mistral', name: 'Mistral', category: 'ai', authType: 'apikey', issuedBy: 'provider', credentialHint: 'API key from console.mistral.ai', fields: [{ label: 'API Key', secret: true }] },
  { id: 'deepseek', name: 'DeepSeek', category: 'ai', authType: 'apikey', issuedBy: 'provider', credentialHint: 'API key from platform.deepseek.com, starts with sk-', fields: [{ label: 'API Key', secret: true, pattern: '^sk-', example: 'sk-…' }] },
  { id: 'perplexity', name: 'Perplexity', category: 'ai', authType: 'apikey', issuedBy: 'provider', credentialHint: 'API key, starts with pplx-', fields: [{ label: 'API Key', secret: true, pattern: '^pplx-', example: 'pplx-…' }] },
  { id: 'ollama', name: 'Ollama', category: 'ai', authType: 'apikey', issuedBy: 'provider', credentialHint: 'NOT a key — the base URL of your Ollama server, e.g. http://localhost:11434', fields: [{ label: 'Server Base URL', secret: true, pattern: '^https?://', example: 'http://localhost:11434' }] },
  { id: 'cohere', name: 'Cohere', category: 'ai', authType: 'apikey', issuedBy: 'provider', credentialHint: 'API key from the Cohere dashboard', fields: [{ label: 'API Key', secret: true }] },
  { id: 'stability', name: 'Stability AI', category: 'ai', authType: 'apikey', issuedBy: 'provider', credentialHint: 'API key, starts with sk-', fields: [{ label: 'API Key', secret: true, pattern: '^sk-', example: 'sk-…' }] },
  { id: 'elevenlabs', name: 'ElevenLabs', category: 'ai', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Sent as the xi-api-key header', fields: [{ label: 'API Key (xi-api-key)', secret: true }] },
  { id: 'replicate', name: 'Replicate', category: 'ai', authType: 'apikey', issuedBy: 'provider', credentialHint: 'API token, starts with r8_', fields: [{ label: 'API Token', secret: true, pattern: '^r8_', example: 'r8_…' }] },
  { id: 'huggingface', name: 'Hugging Face', category: 'ai', authType: 'apikey', issuedBy: 'provider', credentialHint: 'User access token, starts with hf_', fields: [{ label: 'User Access Token', secret: true, pattern: '^hf_', example: 'hf_…' }] },

  // Messaging & APIs (12)
  { id: 'mailchimp', name: 'Mailchimp', category: 'messaging', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Keep the -us21 suffix — it selects the data centre and the API fails without it', fields: [{ label: 'API Key (keep the -us21 suffix)', secret: true, pattern: '-[a-z]{2}[0-9]{1,2}$', example: 'abc123def456-us21' }] },
  { id: 'sendgrid', name: 'SendGrid', category: 'messaging', authType: 'apikey', issuedBy: 'provider', credentialHint: 'API key, starts with SG.', fields: [{ label: 'API Key', secret: true, pattern: '^SG\\.', example: 'SG.xxxx.yyyy' }] },
  { id: 'twilio', name: 'Twilio', category: 'messaging', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Account SID:Auth Token', join: ':', fields: [{ label: 'Account SID' }, { label: 'Auth Token', secret: true }] },
  { id: 'onesignal', name: 'OneSignal', category: 'messaging', authType: 'apikey', issuedBy: 'provider', join: '|', fields: [{ label: 'App ID' }, { label: 'REST API Key', secret: true }] },
  { id: 'telegram', name: 'Telegram', category: 'messaging', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Bot token from BotFather, e.g. 123456:AAH...', fields: [{ label: 'Bot Token', secret: true, pattern: '^[0-9]+:', example: '123456789:AAH…' }] },
  { id: 'mapbox', name: 'Mapbox', category: 'messaging', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Access token, starts with pk. or sk.', fields: [{ label: 'Access Token', secret: true, pattern: '^(pk\\.|sk\\.)', example: 'pk.eyJ1…' }] },
  { id: 'postmark', name: 'Postmark', category: 'messaging', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Server API token (not the account token)', fields: [{ label: 'Server API Token', secret: true }] },
  // Flodesk authenticates with HTTP BASIC, the key as the username and an
  // EMPTY password — not a bearer token, which is the assumption that makes a
  // valid key look broken. Confirmed against developers.flodesk.com.
  // API keys are paid-plan only; a trial account cannot create one.
  { id: 'flodesk', name: 'Flodesk', category: 'messaging', authType: 'apikey', issuedBy: 'provider', credentialHint: 'My Account > Integrations > API keys. Paid plans only — trial accounts cannot create one.', fields: [{ label: 'API Key', secret: true }] },
  { id: 'resend', name: 'Resend', category: 'messaging', authType: 'apikey', issuedBy: 'provider', credentialHint: 'API key, starts with re_', fields: [{ label: 'API Key', secret: true, pattern: '^re_', example: 're_…' }] },
  { id: 'pusher', name: 'Pusher', category: 'messaging', authType: 'apikey', issuedBy: 'provider', join: '|', fields: [{ label: 'App ID' }, { label: 'Key' }, { label: 'Secret', secret: true }, { label: 'Cluster (e.g. us2)' }] },
  { id: 'vonage', name: 'Vonage', category: 'messaging', authType: 'apikey', issuedBy: 'provider', join: ':', fields: [{ label: 'API Key' }, { label: 'API Secret', secret: true }] },
  { id: 'whatsapp', name: 'WhatsApp', category: 'messaging', authType: 'apikey', issuedBy: 'provider', join: '|', credentialHint: 'Cloud API. Use a PERMANENT System User token — the default one expires in 24h', fields: [{ label: 'Phone Number ID' , pattern: '^[0-9]+$', example: '12345678' }, { label: 'Permanent Access Token', secret: true }, { label: 'WhatsApp Business Account ID', optional: true , pattern: '^[0-9]+$', example: '12345678' }] },
  { id: 'discord', name: 'Discord', category: 'messaging', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Bot token from the Bot tab of your application', fields: [{ label: 'Bot Token', secret: true }] },
  { id: 'gmail', name: 'Gmail', category: 'messaging', authType: 'oauth' },

  // Ecommerce platforms (8) — inventory named all 8 explicitly
  { id: 'shopify', name: 'Shopify', category: 'ecommerce', authType: 'apikey', issuedBy: 'provider', join: '|', fields: [{ label: 'Store domain (x.myshopify.com)' , pattern: '\\.myshopify\\.com$', example: 'acme.myshopify.com' }, { label: 'Admin API access token', secret: true }] },
  { id: 'bigcommerce', name: 'BigCommerce', category: 'ecommerce', authType: 'apikey', issuedBy: 'provider', join: '|', fields: [{ label: 'Store hash' }, { label: 'Access token', secret: true }] },
  { id: 'etsy', name: 'Etsy', category: 'ecommerce', authType: 'apikey', issuedBy: 'provider', join: '|', credentialHint: 'The keystring IS the OAuth 2.0 client ID', fields: [{ label: 'Keystring (Client ID)' }, { label: 'Shared Secret', secret: true }] },
  { id: 'amazon', name: 'Amazon', category: 'ecommerce', authType: 'apikey', issuedBy: 'provider', join: '|', credentialHint: 'Login with Amazon credentials — the client secret expires every 180 days', fields: [{ label: 'LWA Client ID' , pattern: '^amzn1\\.application-oa2-client\\.', example: 'amzn1.application-oa2-client.abc123' }, { label: 'LWA Client Secret', secret: true }, { label: 'Refresh Token', secret: true }] },
  { id: 'magento', name: 'Magento', category: 'ecommerce', authType: 'apikey', issuedBy: 'provider', join: '|', credentialHint: 'Integration token from System > Extensions > Integrations', fields: [{ label: 'Store Base URL' , pattern: '^https?://', example: 'https://example.com' }, { label: 'Integration Access Token', secret: true }] },
  { id: 'wix', name: 'Wix', category: 'ecommerce', authType: 'apikey', issuedBy: 'provider', join: '|', credentialHint: 'Site-level calls need the site ID; account-level calls need the account ID', fields: [{ label: 'API Key', secret: true }, { label: 'Site ID' }, { label: 'Account ID', optional: true }] },
  { id: 'squarespace', name: 'Squarespace', category: 'ecommerce', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Commerce API key — never expires while the site is active', fields: [{ label: 'Commerce API Key', secret: true }] },
  { id: 'lemonsqueezy', name: 'Lemon Squeezy', category: 'ecommerce', authType: 'apikey', issuedBy: 'provider', join: '|', credentialHint: 'Store ID is top-right on the dashboard', fields: [{ label: 'API Key', secret: true }, { label: 'Store ID', optional: true , pattern: '^[0-9]+$', example: '12345678' }] },

  // ── Fulfillment (POD partners) — added 2026-07-24 by direction. These are
  // the providers that will also quote shipping/tax per the doctrine
  // (fulfillment delegates, no Woo-style zones engine). Printful + Printify
  // have live credential testers; the rest store-and-hold until their
  // Counter fleet modules land.
  // Printful retired API-key/Basic auth: the API now answers "Basic API token
  // authentication is no longer supported... create a new OAuth 2.0 token".
  // The panel asked for a Consumer key + secret, which no longer authenticates
  // anything — so it is a token field now. Store ID is still needed by accounts
  // with more than one store.
  { id: 'printful', name: 'Printful', category: 'fulfillment', authType: 'apikey', join: '|', issuedBy: 'provider', credentialHint: 'An OAuth 2.0 access token from developers.printful.com — legacy API keys no longer work', note: 'Printful → Developers → create a token with products/read and orders read+write. Old Consumer key/secret pairs are rejected by Printful now.', fields: [{ label: 'API token', secret: true }, { label: 'Store ID', optional: true, pattern: '^[0-9]+$', example: '12345678' }] , connectsVia: 'store-pull-woo' },
  { id: 'printify', name: 'Printify', category: 'fulfillment', authType: 'apikey', issuedBy: 'provider', join: '|', credentialHint: 'Personal Access Token (expires after 1 year)', fields: [{ label: 'Personal Access Token', secret: true }, { label: 'Shop ID', optional: true , pattern: '^[0-9]+$', example: '12345678' }] , connectsVia: 'store-pull-woo' },
  { id: 'gelato', name: 'Gelato', category: 'fulfillment', authType: 'apikey', issuedBy: 'provider', join: '|', credentialHint: 'Sent as the X-API-KEY header', fields: [{ label: 'API Key', secret: true }, { label: 'Store ID (ecommerce endpoints only)', optional: true }], connectsVia: 'store-pull-woo' },
  { id: 'gooten', name: 'Gooten', category: 'fulfillment', authType: 'apikey', issuedBy: 'provider', join: '|', credentialHint: 'Both are in Gooten: Settings > API', fields: [{ label: 'Recipe ID' }, { label: 'Partner Billing Key', secret: true }], connectsVia: 'store-pull-woo' },
  { id: 'spod', name: 'SPOD', category: 'fulfillment', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Spreadconnect API token — shape NOT confirmed against live docs', fields: [{ label: 'API Key (Spreadconnect dashboard)', secret: true }], connectsVia: 'store-pull-woo' },
  // Bam's named POD partners (2026-07-24): store-and-hold until their fleet
  // modules land — no live testers wired until each API is verified.
  { id: 'podplus', name: 'Podplus', category: 'fulfillment', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Credential shape NOT verified — no public API docs found. Confirm with the vendor before relying on this.', fields: [{ label: 'API Key', secret: true }], connectsVia: 'store-pull-woo' },
  { id: 'podpartner', name: 'PodPartner', category: 'fulfillment', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Credential shape NOT verified — no public API docs found. Confirm with the vendor before relying on this.', fields: [{ label: 'API Key', secret: true }], connectsVia: 'store-pull-woo' },
  { id: 'tapstitch', name: 'Tapstitch', category: 'fulfillment', authType: 'apikey', join: '|', issuedBy: 'your-store', credentialHint: 'Generated by your store, then given to Tapstitch', fields: [{ label: 'Consumer Key' }, { label: 'Consumer Secret', secret: true }], connectsVia: 'store-pull-woo' },
  { id: 'contrado', name: 'Contrado', category: 'fulfillment', authType: 'apikey', issuedBy: 'provider', credentialHint: 'API key from your Contrado account — exact field names not public, confirm with the vendor', fields: [{ label: 'API Key', secret: true }], connectsVia: 'store-pull-woo' },

  // Payments (12)
  { id: 'stripe', name: 'Stripe', category: 'payments', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Secret key, starts with sk_live_ or sk_test_', fields: [{ label: 'Secret Key', secret: true, pattern: '^sk_(live|test)_', example: 'sk_live_…' }] },
  { id: 'paypal', name: 'PayPal', category: 'payments', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Client ID:Secret', join: ':', fields: [{ label: 'Client ID' }, { label: 'Client Secret', secret: true }] },
  { id: 'square', name: 'Square', category: 'payments', authType: 'apikey', issuedBy: 'provider', join: '|', fields: [{ label: 'Access Token', secret: true }, { label: 'Location ID' }, { label: 'Environment ("sandbox" or blank)', optional: true }] },
  { id: 'braintree', name: 'Braintree', category: 'payments', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Public Key:Private Key', join: ':', fields: [{ label: 'Public Key' }, { label: 'Private Key', secret: true }] },
  { id: 'adyen', name: 'Adyen', category: 'payments', authType: 'apikey', issuedBy: 'provider', join: '|', fields: [{ label: 'API Key', secret: true }, { label: 'Merchant Account' }] },
  { id: 'klarna', name: 'Klarna', category: 'payments', authType: 'apikey', issuedBy: 'provider', join: '|', credentialHint: 'The Merchant Portal shows both together', fields: [{ label: 'Username (UID)' }, { label: 'Password (API key)', secret: true }] },
  { id: 'coinbase-commerce', name: 'Coinbase Commerce', category: 'payments', authType: 'apikey', issuedBy: 'provider', join: '|', credentialHint: 'API key from Settings; shared secret from Settings > Notifications', fields: [{ label: 'API Key', secret: true }, { label: 'Webhook Shared Secret', secret: true, optional: true }] },
  { id: 'authorizenet', name: 'Authorize.net', category: 'payments', authType: 'apikey', issuedBy: 'provider', join: '|', fields: [{ label: 'API Login ID' }, { label: 'Transaction Key', secret: true }] },
  { id: 'mollie', name: 'Mollie', category: 'payments', authType: 'apikey', issuedBy: 'provider', credentialHint: 'API key, starts with live_ or test_', fields: [{ label: 'API Key', secret: true, pattern: '^(live|test)_', example: 'live_…' }] },
  { id: 'razorpay', name: 'Razorpay', category: 'payments', authType: 'apikey', issuedBy: 'provider', join: '|', credentialHint: 'The secret is shown only once when generated', fields: [{ label: 'Key ID' , pattern: '^rzp_', example: 'rzp_live_abc123' }, { label: 'Key Secret', secret: true }] },
  { id: 'wise', name: 'Wise', category: 'payments', authType: 'apikey', issuedBy: 'provider', join: '|', credentialHint: 'Most endpoints need the profile ID as well as the token', fields: [{ label: 'API Token', secret: true }, { label: 'Profile ID', optional: true }] },
  { id: 'payu', name: 'PayU', category: 'payments', authType: 'apikey', issuedBy: 'provider', join: '|', credentialHint: 'Client ID is the Merchant POS ID', fields: [{ label: 'Client ID (POS ID)' }, { label: 'Client Secret', secret: true }] },
  { id: 'whop', name: 'Whop', category: 'payments', authType: 'apikey', issuedBy: 'provider', join: '|', credentialHint: 'Company API key, plus the biz_ id from your dashboard URL', fields: [{ label: 'API Key', secret: true }, { label: 'Company ID', optional: true, pattern: '^biz_', example: 'biz_XXXXXXXX' }] },

  // External apps (18)
  { id: 'slack', name: 'Slack', category: 'apps', authType: 'oauth' },
  { id: 'notion', name: 'Notion', category: 'apps', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Internal integration secret, starts with ntn_ or secret_', fields: [{ label: 'Internal Integration Secret', secret: true, pattern: '^(ntn_|secret_)', example: 'ntn_…' }] },
  { id: 'airtable', name: 'Airtable', category: 'apps', authType: 'apikey', issuedBy: 'provider', join: '|', credentialHint: 'The token must be granted access to that specific base', fields: [{ label: 'Personal Access Token', secret: true }, { label: 'Base ID (appXXXXXXXXXXXXXX)', optional: true , pattern: '^app[A-Za-z0-9]{10,}$', example: 'appAbCdEfGhIjKlMn' }] },
  { id: 'google-drive', name: 'Google Drive', category: 'apps', authType: 'oauth' },
  { id: 'google-calendar', name: 'Google Calendar', category: 'apps', authType: 'oauth' },
  { id: 'google-sheets', name: 'Google Sheets', category: 'apps', authType: 'oauth' },
  { id: 'dropbox', name: 'Dropbox', category: 'apps', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Generated access token from the app console', fields: [{ label: 'Access Token', secret: true }] },
  { id: 'figma', name: 'Figma', category: 'apps', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Personal access token, starts with figd_', fields: [{ label: 'Personal Access Token', secret: true, pattern: '^figd_', example: 'figd_…' }] },
  { id: 'github', name: 'GitHub', category: 'apps', authType: 'oauth' },
  { id: 'linear', name: 'Linear', category: 'apps', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Personal API key, starts with lin_api_', fields: [{ label: 'Personal API Key', secret: true, pattern: '^lin_api_', example: 'lin_api_…' }] },
  { id: 'zapier', name: 'Zapier', category: 'apps', authType: 'apikey', issuedBy: 'your-store', credentialHint: 'Paste the Zapier webhook URL you want Therum OS to POST to', fields: [{ label: 'Webhook URL', secret: true, pattern: '^https://hooks\\.zapier\\.com/', example: 'https://hooks.zapier.com/hooks/catch/…' }] },
  { id: 'trello', name: 'Trello', category: 'apps', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Key:Token', join: ':', fields: [{ label: 'API Key' }, { label: 'Token', secret: true }] },
  { id: 'asana', name: 'Asana', category: 'apps', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Personal access token, starts with 1/', fields: [{ label: 'Personal Access Token', secret: true, pattern: '^1/', example: '1/1234567890:…' }] },
  { id: 'jira', name: 'Jira', category: 'apps', authType: 'apikey', issuedBy: 'provider', join: '|', credentialHint: 'Atlassian account API token, used as the password in basic auth', fields: [{ label: 'Site URL (https://you.atlassian.net)' , pattern: '^https://[a-z0-9-]+\\.atlassian\\.net', example: 'https://acme.atlassian.net' }, { label: 'Email' , pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', example: 'you@example.com' }, { label: 'API Token', secret: true }] },
  { id: 'zoom', name: 'Zoom', category: 'apps', authType: 'apikey', issuedBy: 'provider', join: '|', credentialHint: 'Server-to-Server OAuth app credentials', fields: [{ label: 'Account ID' }, { label: 'Client ID' }, { label: 'Client Secret', secret: true }] },
  { id: 'calendly', name: 'Calendly', category: 'apps', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Personal access token from Integrations > API and webhooks', fields: [{ label: 'Personal Access Token', secret: true }] },
  { id: 'hubspot', name: 'HubSpot', category: 'apps', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Private app access token, starts with pat-', fields: [{ label: 'Private App Access Token', secret: true, pattern: '^pat-', example: 'pat-na1-…' }] },
  { id: 'salesforce', name: 'Salesforce', category: 'apps', authType: 'apikey', issuedBy: 'provider', join: '|', credentialHint: 'Connected app consumer key/secret plus your My Domain URL', fields: [{ label: 'Instance URL (https://you.my.salesforce.com)' , pattern: '^https?://', example: 'https://example.com' }, { label: 'Client ID (Consumer Key)' }, { label: 'Client Secret (Consumer Secret)', secret: true }] },
  { id: 'intercom', name: 'Intercom', category: 'apps', authType: 'apikey', issuedBy: 'provider', credentialHint: 'Access token from the app Authentication settings', fields: [{ label: 'Access Token', secret: true }] },
  { id: 'zendesk', name: 'Zendesk', category: 'apps', authType: 'apikey', issuedBy: 'provider', join: '|', credentialHint: 'Subdomain is the bit before .zendesk.com', fields: [{ label: 'Subdomain' , pattern: '^[a-z0-9][a-z0-9-]*$', example: 'acme' }, { label: 'Email' , pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', example: 'you@example.com' }, { label: 'API Token', secret: true }] },

  // Customer sign-in (3) — added 2026-07-28 for Counter's social sign-in.
  //
  // These are NOT admin logins. They let a SHOPPER prove they are a shopper,
  // and they exist here rather than as loose settings because of Counter's
  // standing rule: it never asks the merchant for API keys, it pulls them
  // from Nexus (see nexusBridge.ts).
  //
  // Only the client id is strictly needed to VERIFY a sign-in — the token is
  // checked against the provider's published keys and its audience must be
  // this client id. The secret is stored because the browser-side flows that
  // return an authorisation code (rather than an id_token) need it to
  // exchange, and splitting one provider's credentials across two places is
  // how they drift.
  { id: 'google-signin', name: 'Sign in with Google', category: 'identity', authType: 'apikey', issuedBy: 'provider', join: '|', fields: [{ label: 'Client ID' , pattern: '\\.apps\\.googleusercontent\\.com$', example: '1234-abc.apps.googleusercontent.com' }, { label: 'Client Secret', secret: true, optional: true }] },
  { id: 'apple-signin', name: 'Sign in with Apple', category: 'identity', authType: 'apikey', issuedBy: 'provider', join: '|', fields: [{ label: 'Services ID (the client_id)' }, { label: 'Team ID', optional: true }, { label: 'Key ID', optional: true }] },
  { id: 'facebook-login', name: 'Facebook Login', category: 'identity', authType: 'apikey', issuedBy: 'provider', join: '|', fields: [{ label: 'App ID' }, { label: 'App Secret', secret: true }] },

  // Hosting & infrastructure (1) — added 2026-08-01.
  //
  // Not another integration for the store: this is the provider that owns the
  // MACHINE. Settings > Server administers the box from inside it and therefore
  // dies with it; a credential here is the way back in when the box is wedged,
  // because the provider's API answers from outside.
  //
  // Verified against Hostinger's own published tool list (npm hostinger-api-mcp
  // 1.26.0) rather than documentation prose: bearer token, base
  // developers.hostinger.com. Their API is in beta.
  { id: 'hostinger', name: 'Hostinger', category: 'hosting', authType: 'apikey', issuedBy: 'provider', credentialHint: 'API token from hPanel > Dev Tools > API. Shown once — copy it then.', note: 'Used for out-of-band control: restart, snapshot and status when the server itself is unreachable.', fields: [{ label: 'API Token', secret: true }] },
];

// Custom connectors: any id matching custom-<slug> is a valid provider even
// though it's not in the catalog — merchants wire arbitrary APIs (a niche
// POD partner, an internal service) into the same vault, with the same
// encryption, audit log, and webhook receiver. The display name derives
// from the slug.
export const CUSTOM_ID = /^custom-[a-z0-9][a-z0-9-]{1,29}$/;

export function findProvider(id: string): CatalogProvider | undefined {
  const listed = nexusCatalog.find((p) => p.id === id);
  if (listed) return listed;
  if (CUSTOM_ID.test(id)) {
    const name = id.slice(7).split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return { id, name: `${name} (custom)`, category: 'custom', authType: 'apikey', credentialHint: 'API key — or "key|https://test-url" to enable Test' };
  }
  return undefined;
}
