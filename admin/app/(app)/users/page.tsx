import { apiGet } from '../../../lib/api';
import { RoleAssignSelect } from './RoleAssignSelect';

export const dynamic = 'force-dynamic';

interface AdminUserRow {
  id: string;
  username: string;
  totpEnabled: boolean;
  createdAt: string;
  roleId: string | null;
}
interface RoleOption {
  id: string;
  name: string;
}

export default async function UsersPage() {
  let users: AdminUserRow[] | null = null;
  let roles: RoleOption[] = [];
  let err: string | null = null;
  try {
    [users, roles] = await Promise.all([apiGet<AdminUserRow[]>('/api/users'), apiGet<RoleOption[]>('/api/roles')]);
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  return (
    <section>
      <h1>Users</h1>
      <p className="muted">Admin accounts with access to this dashboard.</p>
      {err && <div className="notice">API offline ({err})</div>}
      <table>
        <thead>
          <tr>
            <th>Username</th>
            <th>Role</th>
            <th>Two-factor</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {users?.map((u) => (
            <tr key={u.id}>
              <td>{u.username}</td>
              <td>
                <RoleAssignSelect userId={u.id} initialRoleId={u.roleId} roles={roles} />
              </td>
              <td>
                <span className={'pill ' + (u.totpEnabled ? 'pill-ok' : '')}>{u.totpEnabled ? 'Enabled' : 'Off'}</span>
              </td>
              <td className="muted">{new Date(u.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
          {!users?.length && !err && (
            <tr>
              <td colSpan={4} className="muted">
                No users found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
