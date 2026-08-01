// Server panel actions. What is tested here is the SHAPE of the surface, not
// whether ufw works — a laptop has no ufw, and a test that ran these for real
// would be asserting about the machine rather than about this code.
//
// The shape is the security property: a fixed list, no path from a request to
// an argv, every deployed-only action refused off a server, an audit row per
// run, and no secret in what comes back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { createHmac } from 'node:crypto';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { HOST_ACTIONS, actionById, hostActionService } from '../dist/services/hostAction.service.js';

const SECRET = process.env.JWT_SECRET ?? '';
function jwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const n = Math.floor(Date.now() / 1000);
  const d = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'host-action-test', role: 'admin', iat: n, exp: n + 3600 })}`;
  return `${d}.${createHmac('sha256', SECRET).update(d).digest('base64url')}`;
}
const auth = () => ({ authorization: `Bearer ${jwt()}` });

let app;

before(async () => {
  app = await buildServer();
});

after(async () => {
  await db.hostActionLog.deleteMany({ where: { actionId: { startsWith: 'redis.' } } }).catch(() => {});
  await app.close();
  await closeQueues();
  await disconnectDb();
});

test('every action is fully declared — id, command, revert, risk', () => {
  const seen = new Set();
  for (const a of HOST_ACTIONS) {
    assert.ok(!seen.has(a.id), `duplicate action id ${a.id}`);
    seen.add(a.id);
    assert.match(a.id, /^[a-z0-9]+\.[a-z0-9-]+$/, `${a.id} follows group.name`);
    assert.ok(a.command.length > 0, `${a.id} states what it runs`);
    assert.ok(a.revert.length > 0, `${a.id} states how to undo it`);
    assert.ok(['read', 'restart', 'sensitive'].includes(a.risk), `${a.id} declares a risk`);
    assert.equal(typeof a.run, 'function');
  }
});

test('SENSITIVE actions all name a rollback that is not "nothing"', () => {
  for (const a of HOST_ACTIONS.filter((x) => x.risk === 'sensitive')) {
    assert.doesNotMatch(a.revert, /^nothing/i, `${a.id} must say how to undo itself`);
  }
});

test('every rule an action claims to fix is a real advisor rule', async () => {
  const { ALL_RULES } = await import('../dist/services/hostAdvisor.service.js');
  const ids = new Set(ALL_RULES.map((r) => r.id));
  for (const a of HOST_ACTIONS) {
    for (const f of a.fixes) assert.ok(ids.has(f), `${a.id} claims to fix unknown rule "${f}"`);
  }
});

test('an unknown action id is refused and never reaches a process', async () => {
  assert.equal(actionById('rm.-rf'), undefined);
  await assert.rejects(() => hostActionService.run('rm.-rf'), /Unknown action/);

  const res = await app.inject({ method: 'POST', url: '/api/host/actions/nope.nope/run', headers: auth() });
  assert.equal(res.statusCode, 404);
});

// The injection shape a panel like this exists to be attacked with. There is
// no interpolation anywhere, so these are just ids that do not exist — the
// assertion is that they 404 rather than doing anything at all.
test('AUDIT: a shell payload in the id is a 404, not an execution', async () => {
  for (const payload of ['pm2.status; id', 'pm2.status && whoami', '$(id)', '../../etc/passwd', 'pm2.status\nid']) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/host/actions/${encodeURIComponent(payload)}/run`,
      headers: auth(),
    });
    assert.equal(res.statusCode, 404, `${payload} refused`);
  }
});

test('deployed-only actions refuse to run off a Linux server', async () => {
  const deployed = os.platform() === 'linux';
  const deployedOnly = HOST_ACTIONS.filter((a) => a.scope === 'deployed');
  assert.ok(deployedOnly.length > 0, 'there are server-only actions');

  if (deployed) {
    // On the VPS this branch is the real one; nothing to assert about refusal.
    assert.ok(hostActionService.list().every((a) => a.available));
    return;
  }
  for (const a of deployedOnly) {
    await assert.rejects(() => hostActionService.run(a.id), /only exists on a Linux server/, `${a.id} refused locally`);
  }
  assert.ok(hostActionService.list().some((a) => a.available === false), 'the list marks them unavailable');
});

test('the whole surface requires an operator session', async () => {
  for (const url of ['/api/host/actions', '/api/host/probes']) {
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401, `${url} needs auth`);
  }
  const run = await app.inject({ method: 'POST', url: '/api/host/actions/pm2.status/run' });
  assert.equal(run.statusCode, 401);
});

test('a dry run reports the command and executes nothing', async () => {
  const before = await db.hostActionLog.count();
  const result = await hostActionService.run('redis.tune-memory', { dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.command, actionById('redis.tune-memory').command);
  assert.equal(await db.hostActionLog.count(), before, 'a dry run writes no audit row');
});

test('a real run is audited, and the output carries no secret', async () => {
  // redis.tune-memory is scope 'any' — it works on the laptop, which makes it
  // the one action that can prove the run/audit path end to end here.
  const { redis } = await import('../dist/lib/redis.js');
  const [, previousMax] = await redis.config('GET', 'maxmemory');
  const [, previousPolicy] = await redis.config('GET', 'maxmemory-policy');

  const result = await hostActionService.run('redis.tune-memory', { actorId: 'host-action-test' });
  assert.equal(result.ok, true, result.output);
  assert.match(result.output, /volatile-lru/, 'policy reported back');
  assert.doesNotMatch(result.output, new RegExp(SECRET.slice(0, 12)), 'no JWT secret in the output');

  const row = await db.hostActionLog.findFirst({ where: { actionId: 'redis.tune-memory' }, orderBy: { at: 'desc' } });
  assert.ok(row, 'the run was logged');
  assert.equal(row.actorId, 'host-action-test', 'the log names who ran it');
  assert.equal(row.ok, true);

  // Put the dev machine back exactly as it was — this test changes a live
  // service, so restoring is part of the test, not an afterthought.
  await redis.config('SET', 'maxmemory', previousMax);
  await redis.config('SET', 'maxmemory-policy', previousPolicy);
});

test('SURVIVES A RESTART: the row is written before the command runs', async () => {
  // pm2.reload-api restarts the process handling the request, so a row written
  // on completion would never be written at all. Proven by watching the row
  // appear WHILE the action is still in flight.
  const action = actionById('redis.tune-memory');
  const realRun = action.run;
  let sawRowMidFlight = null;
  action.run = async () => {
    sawRowMidFlight = await db.hostActionLog.findFirst({
      where: { actionId: 'redis.tune-memory', status: 'running' },
      orderBy: { at: 'desc' },
    });
    return 'ok';
  };
  try {
    await hostActionService.run('redis.tune-memory', { actorId: 'restart-test' });
  } finally {
    action.run = realRun;
  }
  assert.ok(sawRowMidFlight, 'the row exists before the command finishes');
  assert.equal(sawRowMidFlight.status, 'running');
  assert.equal(sawRowMidFlight.actorId, 'restart-test');

  const after = await db.hostActionLog.findUnique({ where: { id: sawRowMidFlight.id } });
  assert.equal(after.status, 'ok', 'and it is closed out when the command returns');
  assert.ok(after.finishedAt, 'with a finish time');
});

test('a row left running by a restart is closed as interrupted, not guessed', async () => {
  const orphan = await db.hostActionLog.create({
    data: {
      actionId: 'redis.tune-memory',
      actorId: 'restart-test',
      status: 'running',
      at: new Date(Date.now() - 10 * 60_000),
    },
  });
  const closed = await hostActionService.closeInterrupted();
  assert.ok(closed >= 1, 'the sweep found it');

  const row = await db.hostActionLog.findUnique({ where: { id: orphan.id } });
  assert.equal(row.status, 'interrupted', 'not "ok" and not "failed" — nobody saw the end of it');
  assert.match(row.output, /restarted before this finished/);

  // A row from the last minute belongs to a live request and must survive.
  const live = await db.hostActionLog.create({ data: { actionId: 'redis.tune-memory', status: 'running' } });
  await hostActionService.closeInterrupted();
  assert.equal((await db.hostActionLog.findUnique({ where: { id: live.id } })).status, 'running', 'in-flight runs are left alone');
  await db.hostActionLog.delete({ where: { id: live.id } }).catch(() => {});
});

test('a failing action is logged too — the more interesting row of the two', async () => {
  const action = actionById('redis.tune-memory');
  const realRun = action.run;
  action.run = async () => {
    throw new Error('simulated failure');
  };
  try {
    const result = await hostActionService.run('redis.tune-memory');
    assert.equal(result.ok, false);
    assert.match(result.output, /simulated failure/);
    const row = await db.hostActionLog.findFirst({ where: { actionId: 'redis.tune-memory' }, orderBy: { at: 'desc' } });
    assert.equal(row.ok, false, 'the failure is on the record');
  } finally {
    action.run = realRun;
  }
});
