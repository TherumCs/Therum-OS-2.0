'use client';
import { ClientTable, type ClientColumn } from '../ClientTableControls';
import { RoleAssignSelect } from './RoleAssignSelect';

export interface AdminUserRow {
  id: string;
  username: string;
  totpEnabled: boolean;
  createdAt: string;
  roleId: string | null;
}
export interface RoleOption {
  id: string;
  name: string;
}

export function UsersTable({ users, roles }: { users: AdminUserRow[]; roles: RoleOption[] }) {
  const roleName = (id: string | null): string => roles.find((r) => r.id === id)?.name ?? '—';
  const columns: ClientColumn<AdminUserRow>[] = [
    { key: 'username', label: 'Username', value: (u) => u.username },
    {
      key: 'role',
      label: 'Role',
      value: (u) => roleName(u.roleId),
      render: (u) => <RoleAssignSelect userId={u.id} initialRoleId={u.roleId} roles={roles} />,
    },
    {
      key: 'totp',
      label: 'Two-factor',
      value: (u) => (u.totpEnabled ? 'Enabled' : 'Off'),
      render: (u) => <span className={'pill ' + (u.totpEnabled ? 'pill-ok' : '')}>{u.totpEnabled ? 'Enabled' : 'Off'}</span>,
    },
    {
      key: 'createdAt',
      label: 'Created',
      value: (u) => u.createdAt,
      render: (u) => new Date(u.createdAt).toLocaleDateString(),
      className: 'muted',
    },
  ];

  return (
    <ClientTable
      rows={users}
      columns={columns}
      sorts={[
        { key: 'username:asc', label: 'Username A–Z' },
        { key: 'username:desc', label: 'Username Z–A' },
        { key: 'createdAt:desc', label: 'Newest' },
        { key: 'createdAt:asc', label: 'Oldest' },
        { key: 'role:asc', label: 'Role' },
        { key: 'totp:asc', label: 'Two-factor' },
      ]}
      searchPlaceholder="Search users…"
      emptyLabel="No users found."
    />
  );
}
