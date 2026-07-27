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
async function requireMcpAuth(req: FastifyRequest & { mcpScope?: string }, reply: FastifyReply): Promise<void> {
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (bearer?.startsWith('tro_')) {
    const result = await apiTokenService.verify(bearer, req.ip);
    if (!result) {
      reply.status(401).send({ error: { code: 'unauthorized', message: 'Invalid or revoked API token.' } });
      return;
    }
    req.mcpScope = result.scope;
    return;
  }
  try {
    await req.jwtVerify();
    req.mcpScope = 'write'; // a real admin session can do what the admin can
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
