import { apiGet } from '../../../lib/api';
import type { Extension } from '../../../lib/types';
import { toggleExtension } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function ExtensionsPage() {
  let data: Extension[] | null = null;
  let err: string | null = null;
  try {
    data = await apiGet<Extension[]>('/api/extensions');
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  return (
    <section>
      <h1>Extensions</h1>
      {err && <div className="notice">API offline ({err})</div>}
      {data && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Version</th>
              <th>Health</th>
              <th>Active hooks</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td>{e.version}</td>
                <td>
                  <span className={'pill pill-' + e.health}>{e.health}</span>
                </td>
                <td>{e.activeHooks}</td>
                <td className="actions">
                  <form action={toggleExtension.bind(null, e.id, !e.enabled)}>
                    <button className={e.enabled ? 'ghost' : ''}>{e.enabled ? 'Disable' : 'Enable'}</button>
                  </form>
                </td>
              </tr>
            ))}
            {!data.length && (
              <tr>
                <td colSpan={5} className="muted">
                  No extensions registered.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
