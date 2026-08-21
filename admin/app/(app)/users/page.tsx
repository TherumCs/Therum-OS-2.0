import { apiGet } from '../../../lib/api';
import { UsersTable, type AdminUserRow, type RoleOption } from './UsersTable';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  let users: AdminUserRow[] = [];
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
      <UsersTable users={users} roles={roles} />
    </section>
  );
}
