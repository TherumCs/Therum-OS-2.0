import { randomBytes, createHash } from 'node:crypto';
import { db } from '../lib/db.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';

const PREFIX = 'tro_';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Scoped bearer tokens as an alternative to sharing the admin password with
// scripts/CI/external tools — modeled on 1.9.44's Phase-5.1 API Tokens
// system (the most directly-reusable prior art the research pass found),
// simplified to a coarse read/write scope rather than 1.9.44's dotted
// wildcard-scope catalog, since there's no MCP-style tool-calling surface
// here yet to scope against — that catalog would be speculative right now.
export const apiTokenService = {
  async issue(userId: string, name: string, scope: 'read' | 'write', expiresInDays: number | null): Promise<{ token: string; id: string }> {
    const raw = randomBytes(24).toString('base64url');
    const token = `${PREFIX}${raw}`;
    const created = await db.apiToken.create({
      data: {
        userId,
        name,
        scope,
        tokenHash: hashToken(token),
        prefix: token.slice(0, 10),
        expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86400 * 1000) : null,
      },
    });
    return { token, id: created.id }; // token shown once — only the hash persists
  },

  async list(userId: string) {
    const tokens = await db.apiToken.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return tokens.map(({ tokenHash: _tokenHash, ...rest }) => rest); // never re-serialize the hash to the client
  },

  async revoke(userId: string, id: string): Promise<void> {
    const token = await db.apiToken.findUnique({ where: { id } });
    if (!token || token.userId !== userId) throw new NotFoundError('Token not found', 'id');
    if (token.revokedAt) throw new ValidationError('Already revoked.', 'id');
    await db.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
  },

  // Verifies a raw bearer value against the store — returns the owning user
  // id + scope on success, null otherwise (expired/revoked/unknown all just
  // fail closed the same way, no need to distinguish for the caller).
  async verify(rawToken: string, ip: string | null): Promise<{ userId: string; scope: string } | null> {
    if (!rawToken.startsWith(PREFIX)) return null;
    const token = await db.apiToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
    if (!token || token.revokedAt) return null;
    if (token.expiresAt && token.expiresAt.getTime() < Date.now()) return null;
    await db.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date(), lastUsedIp: ip } });
    return { userId: token.userId, scope: token.scope };
  },
};
