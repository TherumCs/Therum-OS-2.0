// MCP site-operations tools: 7-tool surface, read-vs-write scope gate,
// draft-only writes, no credential leakage.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { apiTokenService } from '../dist/services/apiToken.service.js';

const SECRET = process.env.JWT_SECRET ?? '';
function jwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const n = Math.floor(Date.now() / 1000);
  const d = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'mcp-test', role: 'admin', iat: n, exp: n + 3600 })}`;
  return `${d}.${createHmac('sha256', SECRET).update(d).digest('base64url')}`;
}

let app, role, user, readToken, createdContentId;

function rpc(method, params, auth) {
  return app.inject({
    method: 'POST', url: '/api/mcp',
    headers: { authorization: auth, 'content-type': 'application/json' },
    payload: { jsonrpc: '2.0', id: 1, method, params },
  });
}

before(async () => {
  app = await buildServer();
  role = await db.role.create({ data: { name: 'mcptest-role', bundles: ['read'] } });
  user = await db.adminUser.create({ data: { username: 'mcptest-user', passwordHash: 'x', roleId: role.id } });
  readToken = (await apiTokenService.issue(user.id, 'mcptest-read', 'read', null)).token;
});

after(async () => {
  if (createdContentId) await db.content.delete({ where: { id: createdContentId } }).catch(() => {});
  await db.apiToken.deleteMany({ where: { userId: user.id } });
  await db.adminUser.delete({ where: { id: user.id } });
  await db.role.delete({ where: { id: role.id } });
  await app.close();
  await closeQueues();
  await disconnectDb();
});

test('tools/list exposes the expected tool surface', async () => {
  const res = await rpc('tools/list', undefined, `Bearer ${readToken}`);
  const tools = res.json().result.tools.map((t) => t.name);
  for (const t of ['get_preview_url', 'check_queue_status', 'list_content', 'create_draft', 'sales_report', 'list_orders', 'connections_status']) {
    assert.ok(tools.includes(t), `${t} listed`);
  }
});

test('read token: can read (sales_report, connections_status), CANNOT create_draft', async () => {
  const report = await rpc('tools/call', { name: 'sales_report', arguments: { days: 7 } }, `Bearer ${readToken}`);
  const data = JSON.parse(report.json().result.content[0].text);
  assert.equal(data.net, data.gross - data.refunded, 'sales math flows through MCP');

  const conns = await rpc('tools/call', { name: 'connections_status', arguments: {} }, `Bearer ${readToken}`);
  const rows = JSON.parse(conns.json().result.content[0].text);
  assert.ok(Array.isArray(rows));
  assert.doesNotMatch(conns.json().result.content[0].text, /credentialEncrypted|maskedPreview/, 'no credential fields ever');

  const blocked = await rpc('tools/call', { name: 'create_draft', arguments: { title: 'X', bodyHtml: '<p>x</p>' } }, `Bearer ${readToken}`);
  assert.match(blocked.json().error.message, /write-scoped/, 'read token blocked from writes');
});

test('session (write): create_draft creates a DRAFT only', async () => {
  const res = await rpc('tools/call', { name: 'create_draft', arguments: { type: 'post', title: 'mcptest Draft', bodyHtml: '<p>Written by Claude over MCP.</p>' } }, `Bearer ${jwt()}`);
  const out = JSON.parse(res.json().result.content[0].text);
  createdContentId = out.id;
  assert.equal(out.status, 'draft', 'MCP writes are drafts — publishing stays human');
  const row = await db.content.findUnique({ where: { id: out.id } });
  assert.equal(row.status, 'draft');
  assert.equal(row.title, 'mcptest Draft');
});

test('list_orders never exposes access tokens', async () => {
  const res = await rpc('tools/call', { name: 'list_orders', arguments: { limit: 5 } }, `Bearer ${readToken}`);
  assert.doesNotMatch(res.json().result.content[0].text, /accessToken/, 'guest tokens never ride MCP');
});
