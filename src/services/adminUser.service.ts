import { db } from '../lib/db.js';
import { NotFoundError } from '../lib/errors.js';

export const adminUserService = {
  async list() {
    const users = await db.adminUser.findMany({
      select: { id: true, username: true, totpEnabled: true, createdAt: true, roleId: true, role: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return users;
  },

  // roleId: null explicitly means "full admin" — not "leave unchanged".
  // Callers (the Users page's role picker) always send the full intended
  // state, matching how every other single-select control in this app works.
  // A bogus roleId is checked here rather than left to the DB's raw FK
  // constraint (Prisma doesn't turn that into a clean 404 on its own for a
  // plain scalar assignment — only for nested `connect`).
  async assignRole(userId: string, roleId: string | null) {
    const user = await db.adminUser.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('Admin user not found', 'id');
    if (roleId) {
      const role = await db.role.findUnique({ where: { id: roleId } });
      if (!role) throw new NotFoundError('Role not found', 'roleId');
    }
    return db.adminUser.update({ where: { id: userId }, data: { roleId }, select: { id: true, username: true, roleId: true } });
  },
};
