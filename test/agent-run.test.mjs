// Studio assistant: the tool set it is allowed to use, and its bounds.
//
// The loop itself is not exercised here — that would spend real API credit on
// every test run and make the suite depend on a network service. What IS
// tested is the part that must never regress silently: which tools reach the
// model, and that a run refuses input it should refuse.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { disconnectDb } from '../dist/lib/db.js';
import { disconnectRedis } from '../dist/lib/redis.js';
import { closeQueues } from '../dist/lib/queue.js';
import { agentRunService, readOnlyTools } from '../dist/services/agentRun.service.js';
import { mcpTools, findTool } from '../dist/lib/mcpTools.js';

after(async () => {
  // mcpTools imports importQueue at module level, which holds a Redis
  // connection open — see scoped-edit.test.mjs for the full story.
  await closeQueues().catch(() => {});
  await disconnectDb().catch(() => {});
  await disconnectRedis().catch(() => {});
});

test('no write tool is ever offered to the model', () => {
  // THE security property of this feature. A run reads site content, and site
  // content is attacker-controllable; withholding the write tools means a
  // prompt-injected instruction has nothing destructive to call, rather than
  // relying on the model to decline.
  const offered = readOnlyTools();
  const writes = mcpTools.filter((t) => t.write === true).map((t) => t.name);

  assert.ok(writes.length > 0, 'there are write tools to withhold');
  for (const name of writes) {
    assert.ok(!offered.some((t) => t.name === name), `${name} must NOT be offered`);
  }
  assert.ok(!offered.some((t) => t.name === 'apply_edit'), 'apply_edit specifically');
  assert.ok(!offered.some((t) => t.name === 'create_draft'), 'create_draft specifically');
});

test('propose_edit IS offered — the agent may suggest, not apply', () => {
  const offered = readOnlyTools().map((t) => t.name);
  assert.ok(offered.includes('propose_edit'), 'proposing is the agent\'s job');
  assert.ok(offered.includes('read_editable_file'));
  assert.ok(offered.includes('host_scan'));
  assert.ok(offered.includes('list_products'));
});

test('every offered tool has the shape the API requires', () => {
  for (const t of readOnlyTools()) {
    assert.equal(typeof t.name, 'string', 'name');
    assert.ok(t.description && t.description.length > 10, `${t.name} has a real description`);
    assert.equal(typeof t.inputSchema, 'object', `${t.name} has an input schema`);
    assert.equal(t.inputSchema.type, 'object', `${t.name} schema is an object type`);
  }
});

test('an empty or oversized prompt is refused before any API call', async () => {
  await assert.rejects(() => agentRunService.start('   '), /Ask something/i);
  await assert.rejects(() => agentRunService.start('x'.repeat(4001)), /too long/i);
});

test('list withholds step transcripts', () => {
  for (const r of agentRunService.list()) {
    assert.ok(!('steps' in r), 'the list view is metadata only');
  }
});

test('an unknown run id is simply absent', () => {
  assert.equal(agentRunService.get('nope'), undefined);
});

test('list_products reports prices in both minor units and decimal', async () => {
  // Money is minor units everywhere in this codebase. Handing a model a bare
  // 5400 invites it to say "$5400"; the first version of this tool read a
  // priceMinor field that does not exist and returned null for every product.
  const res = await findTool('list_products').handler({});
  assert.ok(!res.isError, res.content[0].text);
  const data = JSON.parse(res.content[0].text);
  assert.equal(typeof data.total, 'number');
  for (const p of data.products) {
    if (p.fromPriceMinor === null) continue;
    assert.equal(typeof p.fromPriceMinor, 'number', 'minor units present');
    assert.equal(p.fromPrice, (p.fromPriceMinor / 100).toFixed(2), 'decimal matches minor units');
  }
});
