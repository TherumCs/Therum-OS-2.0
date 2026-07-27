import { apiGet } from '../../../../lib/api';
import { RedirectsClient, type RedirectRule } from './RedirectsClient';
import { NotFoundMonitorClient, type NotFoundHit } from './NotFoundMonitorClient';

export const dynamic = 'force-dynamic';

// Rules are enforced for real (server.ts's 404 handler checks every
// unmatched request against these before falling through to a real 404 —
// see redirects.service.ts's findMatch()) and every unmatched path is
// logged below. Practical volume today is mostly API-level 404s (bad
// content ids, typo'd routes) rather than organic visitor traffic, since
// no public theme/renderer exists yet — the mechanism itself is real and
// will pick up real visitor 404s the moment one does.
export default async function RedirectsSettingsPage() {
  const [rules, hits] = await Promise.all([
    apiGet<RedirectRule[]>('/api/redirects').catch((): RedirectRule[] => []),
    apiGet<NotFoundHit[]>('/api/redirects/not-found').catch((): NotFoundHit[] => []),
  ]);

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>Redirects</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        301/302 redirects + 404 monitor.
      </p>

      <div className="settings-group">
        <h3 className="settings-group-title">Redirect rules</h3>
        <p className="settings-group-desc">{rules.length} rule(s), checked against every unmatched request before it 404s.</p>
        <RedirectsClient initial={rules} />
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">404 monitor</h3>
        <p className="settings-group-desc">Paths that hit no route and no redirect rule, most-frequent first.</p>
        <NotFoundMonitorClient initial={hits} />
      </div>
    </div>
  );
}
