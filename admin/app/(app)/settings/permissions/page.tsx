import { apiGet } from '../../../../lib/api';
import { BASE_PATH } from '../../../../lib/session';
import { PermissionsManager } from './PermissionsManager';

export const dynamic = 'force-dynamic';

interface AdminUserRow {
  id: string;
  username: string;
}
interface Bundle {
  value: string;
  label: string;
}
interface Role {
  id: string;
  name: string;
  bundles: string[];
  _count: { users: number };
}

// Real role/capability-bundle builder — 1.9.44's own version (7 bundles,
// per-role WooCommerce discounts, a searchable capability picker) also had
// per-role commerce discounts, which has no analog here (no per-role
// pricing concept exists in 2.0's commerce model) — everything else,
// composable bundles forming named custom roles, is built for real below.
export default async function PermissionsSettingsPage() {
  const [users, bundles, roles] = await Promise.all([
    apiGet<AdminUserRow[]>('/api/users').catch((): AdminUserRow[] => []),
    apiGet<Bundle[]>('/api/roles/bundles').catch((): Bundle[] => []),
    apiGet<Role[]>('/api/roles').catch((): Role[] => []),
  ]);

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>Permissions</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Role capabilities.
      </p>

      <PermissionsManager roles={roles} bundles={bundles} userCount={users.length} />

      <div className="settings-group">
        <h3 className="settings-group-title">Assigning roles</h3>
        <p className="settings-group-desc">Roles are defined here, but assigned to a specific account from the Users page.</p>
        <a href={`${BASE_PATH}/users`} className="th-btn" style={{ display: 'inline-flex' }}>
          Manage users →
        </a>
      </div>
    </div>
  );
}
