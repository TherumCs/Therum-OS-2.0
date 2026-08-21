import { apiGet } from '../../../../lib/api';
import { ConnectionsClient, type ConnectionRow, type AuditEntry, type WebhookEntry } from './ConnectionsClient';

export const dynamic = 'force-dynamic';

// Nexus's settings surface — only reachable once the Nexus Studio app is
// enabled (see admin/app/(app)/studio/page.tsx). Credentials are encrypted
// at rest (see src/lib/crypto.ts); only a masked preview ever reaches here.
export default async function ConnectionsSettingsPage({ searchParams }: { searchParams: Promise<{ oauthConnected?: string; oauthError?: string }> }) {
  const params = await searchParams;
  const [connections, auditLog, webhookLog, oauthApps, webhookSecrets] = await Promise.all([
    apiGet<ConnectionRow[]>('/api/connections').catch((): ConnectionRow[] => []),
    apiGet<AuditEntry[]>('/api/connections/audit-log').catch((): AuditEntry[] => []),
    apiGet<WebhookEntry[]>('/api/connections/webhook-log').catch((): WebhookEntry[] => []),
    apiGet<Record<string, boolean>>('/api/connections/oauth/apps').catch((): Record<string, boolean> => ({})),
    apiGet<Record<string, boolean>>('/api/connections/webhook-secrets').catch((): Record<string, boolean> => ({})),
  ]);

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>Connections</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        AI tools, payments, messaging, ecommerce, fulfillment, and external apps — one hub for everything external.
      </p>
      {params.oauthConnected && <div className="notice" style={{ background: 'var(--th-success-bg)', color: 'var(--th-success-text)' }}>Connected {params.oauthConnected} via OAuth.</div>}
      {params.oauthError && <div className="notice">OAuth failed: {params.oauthError}</div>}
      <ConnectionsClient initial={connections} auditLog={auditLog} webhookLog={webhookLog} oauthApps={oauthApps} webhookSecrets={webhookSecrets} />
    </div>
  );
}
