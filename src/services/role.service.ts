import { db } from '../lib/db.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import type { CreateRoleInput, UpdateRoleInput } from '../schemas/role.schema.js';

// Canonical bundle list + labels — the UI's picker and the Zod enum
// (role.schema.ts's BUNDLE_VALUES) both iterate this same set. 'read' and
// 'write' are also literal ApiToken.scope values (a coincidence of naming,
// not a code path shared with role bundles — API-token scope is a separate,
// coarser HTTP-method gate, see middleware/auth.ts).
export const BUNDLES: { value: string; label: string }[] = [
  { value: 'read', label: 'Read' },
  { value: 'write', label: 'Write' },
  { value: 'publish', label: 'Publish' },
  { value: 'edit-broadly', label: 'Edit any content' },
  { value: 'manage-settings', label: 'Manage settings' },
  { value: 'storefront-customer', label: 'Storefront customer' },
  { value: 'storefront-manager', label: 'Storefront manager' },
];

export interface AccessResolution {
  role: 'admin' | 'custom';
  bundles?: string[];
}

export const roleService = {
  async list() {
    return db.role.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { users: true } } } });
  },

  async get(id: string) {
    const role = await db.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundError('Role not found', 'id');
    return role;
  },

  async create(input: CreateRoleInput) {
    return db.role.create({ data: { name: input.name, bundles: input.bundles } });
  },

  async update(id: string, input: UpdateRoleInput) {
    await this.get(id);
    return db.role.update({ where: { id }, data: input });
  },

  // Proactively checked (not left to the DB's onDelete: Restrict FK error)
  // so the caller gets a clean, specific message — how many accounts are
  // still on this role — instead of a raw constraint-violation 500.
  async delete(id: string): Promise<void> {
    await this.get(id);
    const inUse = await db.adminUser.count({ where: { roleId: id } });
    if (inUse > 0) {
      throw new ConflictError(`${inUse} account${inUse === 1 ? '' : 's'} still use this role — reassign them first.`, 'roleId');
    }
    await db.role.delete({ where: { id } });
  },

  // The live lookup app.authenticate calls for every request from a
  // 'custom'-role session (see middleware/auth.ts) — bundles are never
  // baked into the JWT itself, so editing a role's bundles takes effect on
  // that user's very next request, not just their next login.
  async resolveAccess(userId: string): Promise<AccessResolution> {
    const user = await db.adminUser.findUnique({ where: { id: userId }, select: { roleId: true } });
    if (!user?.roleId) return { role: 'admin' };
    const role = await db.role.findUnique({ where: { id: user.roleId } });
    return { role: 'custom', bundles: role?.bundles ?? [] };
  },
};
