// The Connections hub's real provider catalog — 5 categories, 67 providers.
// Started as the inventory's exact 63 (AI 13, Messaging 12, Ecommerce 8,
// Payments 12, Apps 18); the Google family (Gmail, Calendar, Sheets) was
// added 2026-07-23 by direction, bringing Messaging to 13 and Apps to 20.
// OAuth providers: Slack, GitHub, and the four Google services (all four
// share one Google Cloud OAuth app — same client id/secret, different
// scopes). Everything else is a pasted API key.
export type ConnectionCategory = 'ai' | 'messaging' | 'ecommerce' | 'payments' | 'apps' | 'fulfillment' | 'custom';
export type AuthType = 'apikey' | 'oauth';

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
  fields?: { label: string; secret?: boolean; optional?: boolean }[];
  join?: string;
}

export const CATEGORY_LABELS: Record<ConnectionCategory, string> = {
  ai: 'AI tools',
  messaging: 'Messaging & APIs',
  ecommerce: 'Ecommerce platforms',
  payments: 'Payments',
  fulfillment: 'Fulfillment',
  apps: 'External apps',
  custom: 'Custom',
};

export const nexusCatalog: CatalogProvider[] = [
  // AI tools (13)
  { id: 'anthropic', name: 'Anthropic', category: 'ai', authType: 'apikey' },
  { id: 'openai', name: 'OpenAI', category: 'ai', authType: 'apikey' },
  { id: 'gemini', name: 'Gemini', category: 'ai', authType: 'apikey' },
  { id: 'grok', name: 'Grok', category: 'ai', authType: 'apikey' },
  { id: 'mistral', name: 'Mistral', category: 'ai', authType: 'apikey' },
  { id: 'deepseek', name: 'DeepSeek', category: 'ai', authType: 'apikey' },
  { id: 'perplexity', name: 'Perplexity', category: 'ai', authType: 'apikey' },
  { id: 'ollama', name: 'Ollama (local)', category: 'ai', authType: 'apikey' },
  { id: 'cohere', name: 'Cohere', category: 'ai', authType: 'apikey' },
  { id: 'stability', name: 'Stability AI', category: 'ai', authType: 'apikey' },
  { id: 'elevenlabs', name: 'ElevenLabs', category: 'ai', authType: 'apikey' },
  { id: 'replicate', name: 'Replicate', category: 'ai', authType: 'apikey' },
  { id: 'huggingface', name: 'Hugging Face', category: 'ai', authType: 'apikey' },

  // Messaging & APIs (12)
  { id: 'mailchimp', name: 'Mailchimp', category: 'messaging', authType: 'apikey' },
  { id: 'sendgrid', name: 'SendGrid', category: 'messaging', authType: 'apikey' },
  { id: 'twilio', name: 'Twilio', category: 'messaging', authType: 'apikey', credentialHint: 'Account SID:Auth Token', join: ':', fields: [{ label: 'Account SID' }, { label: 'Auth Token', secret: true }] },
  { id: 'onesignal', name: 'OneSignal', category: 'messaging', authType: 'apikey', join: '|', fields: [{ label: 'App ID' }, { label: 'REST API Key', secret: true }] },
  { id: 'telegram', name: 'Telegram', category: 'messaging', authType: 'apikey' },
  { id: 'mapbox', name: 'Mapbox', category: 'messaging', authType: 'apikey' },
  { id: 'postmark', name: 'Postmark', category: 'messaging', authType: 'apikey' },
  { id: 'resend', name: 'Resend', category: 'messaging', authType: 'apikey' },
  { id: 'pusher', name: 'Pusher', category: 'messaging', authType: 'apikey', join: '|', fields: [{ label: 'App ID' }, { label: 'Key' }, { label: 'Secret', secret: true }, { label: 'Cluster (e.g. us2)' }] },
  { id: 'vonage', name: 'Vonage', category: 'messaging', authType: 'apikey', join: ':', fields: [{ label: 'API Key' }, { label: 'API Secret', secret: true }] },
  { id: 'whatsapp', name: 'WhatsApp Business API', category: 'messaging', authType: 'apikey' },
  { id: 'discord', name: 'Discord', category: 'messaging', authType: 'apikey' },
  { id: 'gmail', name: 'Gmail', category: 'messaging', authType: 'oauth' },

  // Ecommerce platforms (8) — inventory named all 8 explicitly
  { id: 'shopify', name: 'Shopify', category: 'ecommerce', authType: 'apikey', join: '|', fields: [{ label: 'Store domain (x.myshopify.com)' }, { label: 'Admin API access token', secret: true }] },
  { id: 'bigcommerce', name: 'BigCommerce', category: 'ecommerce', authType: 'apikey', join: '|', fields: [{ label: 'Store hash' }, { label: 'Access token', secret: true }] },
  { id: 'etsy', name: 'Etsy', category: 'ecommerce', authType: 'apikey' },
  { id: 'amazon', name: 'Amazon', category: 'ecommerce', authType: 'apikey' },
  { id: 'magento', name: 'Magento', category: 'ecommerce', authType: 'apikey' },
  { id: 'wix', name: 'Wix', category: 'ecommerce', authType: 'apikey' },
  { id: 'squarespace', name: 'Squarespace', category: 'ecommerce', authType: 'apikey' },
  { id: 'lemonsqueezy', name: 'Lemon Squeezy', category: 'ecommerce', authType: 'apikey' },

  // ── Fulfillment (POD partners) — added 2026-07-24 by direction. These are
  // the providers that will also quote shipping/tax per the doctrine
  // (fulfillment delegates, no Woo-style zones engine). Printful + Printify
  // have live credential testers; the rest store-and-hold until their
  // Counter fleet modules land.
  { id: 'printful', name: 'Printful', category: 'fulfillment', authType: 'apikey' },
  { id: 'printify', name: 'Printify', category: 'fulfillment', authType: 'apikey' },
  { id: 'gelato', name: 'Gelato', category: 'fulfillment', authType: 'apikey' },
  { id: 'gooten', name: 'Gooten', category: 'fulfillment', authType: 'apikey' },
  { id: 'spod', name: 'SPOD', category: 'fulfillment', authType: 'apikey' },
  // Bam's named POD partners (2026-07-24): store-and-hold until their fleet
  // modules land — no live testers wired until each API is verified.
  { id: 'podplus', name: 'Podplus', category: 'fulfillment', authType: 'apikey' },
  { id: 'podpartner', name: 'PodPartner', category: 'fulfillment', authType: 'apikey' },
  { id: 'tapstitch', name: 'Tapstitch', category: 'fulfillment', authType: 'apikey' },
  { id: 'contrado', name: 'Contrado', category: 'fulfillment', authType: 'apikey' },

  // Payments (12)
  { id: 'stripe', name: 'Stripe', category: 'payments', authType: 'apikey' },
  { id: 'paypal', name: 'PayPal', category: 'payments', authType: 'apikey', credentialHint: 'Client ID:Secret', join: ':', fields: [{ label: 'Client ID' }, { label: 'Client Secret', secret: true }] },
  { id: 'square', name: 'Square', category: 'payments', authType: 'apikey', join: '|', fields: [{ label: 'Access Token', secret: true }, { label: 'Location ID' }, { label: 'Environment ("sandbox" or blank)', optional: true }] },
  { id: 'braintree', name: 'Braintree', category: 'payments', authType: 'apikey', credentialHint: 'Public Key:Private Key', join: ':', fields: [{ label: 'Public Key' }, { label: 'Private Key', secret: true }] },
  { id: 'adyen', name: 'Adyen', category: 'payments', authType: 'apikey', join: '|', fields: [{ label: 'API Key', secret: true }, { label: 'Merchant Account' }] },
  { id: 'klarna', name: 'Klarna', category: 'payments', authType: 'apikey' },
  { id: 'coinbase-commerce', name: 'Coinbase Commerce', category: 'payments', authType: 'apikey' },
  { id: 'authorizenet', name: 'Authorize.net', category: 'payments', authType: 'apikey', join: '|', fields: [{ label: 'API Login ID' }, { label: 'Transaction Key', secret: true }] },
  { id: 'mollie', name: 'Mollie', category: 'payments', authType: 'apikey' },
  { id: 'razorpay', name: 'Razorpay', category: 'payments', authType: 'apikey' },
  { id: 'wise', name: 'Wise', category: 'payments', authType: 'apikey' },
  { id: 'payu', name: 'PayU', category: 'payments', authType: 'apikey' },
  { id: 'whop', name: 'Whop', category: 'payments', authType: 'apikey' },

  // External apps (18)
  { id: 'slack', name: 'Slack', category: 'apps', authType: 'oauth' },
  { id: 'notion', name: 'Notion', category: 'apps', authType: 'apikey' },
  { id: 'airtable', name: 'Airtable', category: 'apps', authType: 'apikey' },
  { id: 'google-drive', name: 'Google Drive', category: 'apps', authType: 'oauth' },
  { id: 'google-calendar', name: 'Google Calendar', category: 'apps', authType: 'oauth' },
  { id: 'google-sheets', name: 'Google Sheets', category: 'apps', authType: 'oauth' },
  { id: 'dropbox', name: 'Dropbox', category: 'apps', authType: 'apikey' },
  { id: 'figma', name: 'Figma', category: 'apps', authType: 'apikey' },
  { id: 'github', name: 'GitHub', category: 'apps', authType: 'oauth' },
  { id: 'linear', name: 'Linear', category: 'apps', authType: 'apikey' },
  { id: 'zapier', name: 'Zapier', category: 'apps', authType: 'apikey' },
  { id: 'trello', name: 'Trello', category: 'apps', authType: 'apikey', credentialHint: 'Key:Token', join: ':', fields: [{ label: 'API Key' }, { label: 'Token', secret: true }] },
  { id: 'asana', name: 'Asana', category: 'apps', authType: 'apikey' },
  { id: 'jira', name: 'Jira', category: 'apps', authType: 'apikey' },
  { id: 'zoom', name: 'Zoom', category: 'apps', authType: 'apikey' },
  { id: 'calendly', name: 'Calendly', category: 'apps', authType: 'apikey' },
  { id: 'hubspot', name: 'HubSpot', category: 'apps', authType: 'apikey' },
  { id: 'salesforce', name: 'Salesforce', category: 'apps', authType: 'apikey' },
  { id: 'intercom', name: 'Intercom', category: 'apps', authType: 'apikey' },
  { id: 'zendesk', name: 'Zendesk', category: 'apps', authType: 'apikey' },
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
