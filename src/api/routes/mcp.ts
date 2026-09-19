import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { mcpTools, findTool } from '../../lib/mcpTools.js';
import { apiTokenService } from '../../services/apiToken.service.js';

const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: unknown;
}

// Not app.authenticate: that decorator 403s a 'read'-scoped API token on any
// non-GET request, but JSON-RPC always transports over POST regardless of
// whether the called tool is read-only. The registry now contains WRITE
// tools (create_draft) — per-tool enforcement happens at tools/call: a
// write-flagged tool requires a 'write'-scoped token or a real session.
const MCP_WRITE_BUNDLES = new Set(['storefront-manager', 'manage-settings', 'catalog-manager', 'fulfillment-manager', 'write']);

async function requireMcpAuth(req: FastifyRequest & { mcpScope?: string }, reply: FastifyReply): Promise<void> {
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (bearer?.startsWith('tro_')) {
    const result = await apiTokenService.verify(bearer, req.ip);
    if (!result) {
      reply.status(401).send({ error: { code: 'unauthorized', message: 'Invalid or revoked API token.' } });
      return;
    }
    // The token's own scope is a CEILING, not a grant. A custom-role user with
    // read-only bundles could otherwise mint a 'write' token (token issuance has
    // no role gate) and get through MCP what the REST API and a session both
    // refuse them. Resolve the owner's live access exactly as the session
    // branch below does; when unsure, read.
    if (result.scope !== 'write') {
      req.mcpScope = 'read';
      return;
    }
    const { roleService } = await import('../../services/role.service.js');
    const access = await roleService.resolveAccess(result.userId).catch(() => null);
    req.mcpScope = access && (access.role === 'admin' || (access.bundles ?? []).some((b) => MCP_WRITE_BUNDLES.has(b))) ? 'write' : 'read';
    return;
  }
  try {
    await req.jwtVerify();
    // jwtVerify only checks signature/expiry — it does NOT inspect `role`. A
    // 2FA 'pending2fa' challenge token (same secret, minted after a correct
    // password but BEFORE the second factor) would otherwise pass here and be
    // handed a full 'write' session, bypassing 2FA entirely. Only the two real
    // session roles may proceed; anything else fails closed (mirrors
    // middleware/auth.ts). Scope follows the role, not a hardcoded 'write'.
    const u = req.user as { sub?: string; role?: string } | undefined;
    const role = u?.role;
    if (role !== 'admin' && role !== 'custom') {
      reply.status(401).send({ error: { code: 'unauthorized', message: 'Authentication required.' } });
      return;
    }
    // Scope follows real capability, NOT a blanket 'write'. A full 'admin' gets
    // write. A 'custom' role only gets write if its live bundles include a
    // write-capable one — a read-only custom admin must not gain write via MCP
    // when it can't in the normal API. When unsure, read (fail closed); a custom
    // admin needing MCP writes uses a write-scoped API token.
    if (role === 'admin') {
      req.mcpScope = 'write';
    } else {
      const { roleService } = await import('../../services/role.service.js');
      const access = await roleService.resolveAccess(u!.sub!);
      req.mcpScope = (access.bundles ?? []).some((b) => MCP_WRITE_BUNDLES.has(b)) ? 'write' : 'read';
    }
  } catch {
    reply.status(401).send({ error: { code: 'unauthorized', message: 'Authentication required.' } });
  }
}

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  app.post('/mcp', { preHandler: requireMcpAuth }, async (req, reply) => {
    const body = req.body as Partial<JsonRpcRequest> | undefined;
    const id = body?.id ?? null;

    if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      reply.send({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } });
      return;
    }

    switch (body.method) {
      case 'initialize':
        reply.send({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'therum-cms-2', version: '2.0.0' },
          },
        });
        return;

      case 'tools/list':
        reply.send({
          jsonrpc: '2.0',
          id,
          result: { tools: mcpTools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) },
        });
        return;

      case 'tools/call': {
        const params = body.params as { name?: string; arguments?: unknown } | undefined;
        const tool = typeof params?.name === 'string' ? findTool(params.name) : undefined;
        if (!tool) {
          reply.send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${String(params?.name)}` } });
          return;
        }
        // Write tools need write scope — a read token can look, not touch.
        if (tool.write && (req as FastifyRequest & { mcpScope?: string }).mcpScope !== 'write') {
          reply.send({ jsonrpc: '2.0', id, error: { code: -32001, message: `Tool ${tool.name} requires a write-scoped API token.` } });
          return;
        }
        const result = await tool.handler(params?.arguments);
        reply.send({ jsonrpc: '2.0', id, result });
        return;
      }

      default:
        reply.send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${body.method}` } });
    }
  });
}
