// Host Advisor: rules are deterministic given fixed probe data, deployed-only
// rules stay silent on a local host, and an unavailable probe is reported as
// unevaluated rather than passing.
//
// The rules are tested against synthetic probe payloads rather than the real
// machine on purpose — a test that scans the host running CI would assert on
// that host's disk usage, which is not a property of this code.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { disconnectDb } from '../dist/lib/db.js';
import { disconnectRedis } from '../dist/lib/redis.js';
import { securityRules } from '../dist/lib/hostRules/security.js';
import { compressionRules } from '../dist/lib/hostRules/compression.js';
import { performanceRules } from '../dist/lib/hostRules/performance.js';
import { ALL_RULES, hostAdvisorService } from '../dist/services/hostAdvisor.service.js';
import { PROBES, redactValue } from '../dist/services/hostProbe.service.js';

const ruleById = (id) => ALL_RULES.find((r) => r.id === id);

/** Evaluate one rule against a probe payload, honouring its declared inputs. */
function evaluate(id, data) {
  const rule = ruleById(id);
  assert.ok(rule, `rule ${id} exists`);
  for (const p of rule.probes) assert.ok(data[p], `test supplied probe ${p} for ${id}`);
  return rule.evaluate(data);
}

test('every rule declares probes that actually exist', () => {
  const ids = new Set(PROBES.map((p) => p.id));
  for (const rule of ALL_RULES) {
    assert.ok(rule.probes.length > 0, `${rule.id} declares at least one probe`);
    for (const p of rule.probes) {
      assert.ok(ids.has(p), `${rule.id} depends on unknown probe "${p}"`);
    }
  }
});

test('rule ids are unique', () => {
  const seen = new Set();
  for (const r of ALL_RULES) {
    assert.ok(!seen.has(r.id), `duplicate rule id ${r.id}`);
    seen.add(r.id);
  }
  assert.equal(ALL_RULES.length, securityRules.length + compressionRules.length + performanceRules.length);
});

test('every finding carries a detail and a fix', () => {
  // A finding with no measurement is an opinion, and one with no fix is a
  // complaint. Both are the failure mode this design exists to avoid.
  const f = evaluate('sec.jwt-placeholder', { secrets: { jwtPlaceholder: true, jwtLength: 11 } });
  assert.ok(f);
  assert.match(f.detail, /11 chars/);
  assert.ok(f.fix.length > 0);
  assert.ok(f.why.length > 0);
});

test('placeholder JWT secret is critical; a strong one is silent', () => {
  const bad = evaluate('sec.jwt-placeholder', { secrets: { jwtPlaceholder: true, jwtLength: 11 } });
  assert.equal(bad.severity, 'critical');

  const good = evaluate('sec.jwt-placeholder', { secrets: { jwtPlaceholder: false, jwtLength: 64 } });
  assert.equal(good, null);
});

test('short JWT secret flagged, but not double-reported with the placeholder rule', () => {
  assert.ok(evaluate('sec.jwt-weak', { secrets: { jwtPlaceholder: false, jwtLength: 12 } }));
  assert.equal(evaluate('sec.jwt-weak', { secrets: { jwtPlaceholder: false, jwtLength: 48 } }), null);
  // Already reported as a placeholder — reporting it twice buries the worse one.
  assert.equal(evaluate('sec.jwt-weak', { secrets: { jwtPlaceholder: true, jwtLength: 12 } }), null);
});

test('tracked .env is critical, .env.example is not', () => {
  const leak = evaluate('sec.env-tracked', { 'git-secrets': { available: true, tracked: ['.env'] } });
  assert.equal(leak.severity, 'critical');
  assert.match(leak.fix, /ROTATE/);

  const clean = evaluate('sec.env-tracked', { 'git-secrets': { available: true, tracked: [] } });
  assert.equal(clean, null);

  // No git available is not evidence of safety.
  assert.equal(evaluate('sec.env-tracked', { 'git-secrets': { available: false, tracked: [] } }), null);
});

test('world-readable env file is reported with its mode', () => {
  const f = evaluate('sec.env-perms', {
    'file-perms': { files: [{ file: '.env', mode: '644', groupOrOtherReadable: true }] },
  });
  assert.match(f.detail, /644/);
  assert.match(f.fix, /chmod 600/);

  const ok = evaluate('sec.env-perms', {
    'file-perms': { files: [{ file: '.env', mode: '600', groupOrOtherReadable: false }] },
  });
  assert.equal(ok, null);
});

test('datastore on a routable address is a finding; loopback is not', () => {
  const exposed = evaluate('sec.datastore-exposed', {
    'service-binding': { databaseHost: '10.0.0.5', databaseLoopback: false, redisHost: '127.0.0.1', redisLoopback: true },
  });
  assert.match(exposed.detail, /10\.0\.0\.5/);
  assert.doesNotMatch(exposed.detail, /Redis/);

  const local = evaluate('sec.datastore-exposed', {
    'service-binding': { databaseHost: '127.0.0.1', databaseLoopback: true, redisHost: '127.0.0.1', redisLoopback: true },
  });
  assert.equal(local, null);
});

test('compression rule reads the response, not a config claim', () => {
  const uncompressed = evaluate('cmp.html-uncompressed', {
    'http-response': { html: { contentEncoding: null, contentType: 'text/html; charset=utf-8', bytes: 120_000 } },
  });
  assert.equal(uncompressed.severity, 'high');
  assert.match(uncompressed.fix, /gzip_proxied any/);

  const compressed = evaluate('cmp.html-uncompressed', {
    'http-response': { html: { contentEncoding: 'gzip', contentType: 'text/html', bytes: 20_000 } },
  });
  assert.equal(compressed, null);

  // Too small to be worth compressing.
  const tiny = evaluate('cmp.html-uncompressed', {
    'http-response': { html: { contentEncoding: null, contentType: 'text/html', bytes: 400 } },
  });
  assert.equal(tiny, null);

  // Not a compressible type.
  const img = evaluate('cmp.html-uncompressed', {
    'http-response': { html: { contentEncoding: null, contentType: 'image/png', bytes: 400_000 } },
  });
  assert.equal(img, null);
});

test('memory pressure uses MemAvailable and stays silent without it', () => {
  // The first version of this rule used os.freemem() and reported 99.6%
  // pressure on an idle 32 GB laptop, because macOS keeps free memory near
  // zero deliberately. Without MemAvailable there is no honest answer.
  const noData = evaluate('perf.memory-pressure', { memory: { availablePct: null, totalGb: 32 } });
  assert.equal(noData, null);

  const healthy = evaluate('perf.memory-pressure', { memory: { availablePct: 40, totalGb: 16 } });
  assert.equal(healthy, null);

  const pressured = evaluate('perf.memory-pressure', { memory: { availablePct: 3, totalGb: 16 } });
  assert.equal(pressured.severity, 'high');
  assert.match(pressured.detail, /97/);
});

test('load is judged per core, not absolute', () => {
  // 8.0 on 16 cores is idle; 8.0 on 2 cores is drowning.
  assert.equal(evaluate('perf.load', { cpu: { load1: 8, cores: 16, loadPerCore: 0.5 } }), null);
  const busy = evaluate('perf.load', { cpu: { load1: 8, cores: 2, loadPerCore: 4 } });
  assert.equal(busy.severity, 'high');
});

test('disk severity escalates and stays quiet with headroom', () => {
  assert.equal(evaluate('perf.disk-full', { disk: { usedPct: 60, freeGb: 200 } }), null);
  assert.equal(evaluate('perf.disk-full', { disk: { usedPct: 88, freeGb: 20 } }).severity, 'high');
  assert.equal(evaluate('perf.disk-full', { disk: { usedPct: 97, freeGb: 2 } }).severity, 'critical');
});

test('shared_buffers rule converts 8kB blocks and respects a tuned instance', () => {
  const totalMemBytes = 16 * 1024 ** 3;
  // 128 MB expressed the way pg_settings reports it: 16384 blocks of 8kB.
  const dflt = evaluate('perf.pg-shared-buffers', {
    'postgres-config': { settings: { shared_buffers: { setting: '16384', unit: '8kB' } }, totalMemBytes },
  });
  assert.ok(dflt, 'default 128MB on a 16GB host is a finding');
  assert.match(dflt.detail, /128 MB/);

  // 4 GB on the same host is deliberate — do not nag.
  const tuned = evaluate('perf.pg-shared-buffers', {
    'postgres-config': { settings: { shared_buffers: { setting: '524288', unit: '8kB' } }, totalMemBytes },
  });
  assert.equal(tuned, null);
});

test('redis advice is volatile-lru, because this Redis holds queues too', () => {
  // Not allkeys-lru. Carts (7-day TTL) and rate limits expire; BullMQ job data
  // does NOT. allkeys-lru would evict queued jobs — silent loss of work.
  const unlimited = evaluate('perf.redis-no-maxmemory', {
    'redis-config': { maxmemoryBytes: 0, maxmemoryPolicy: 'noeviction' },
  });
  assert.match(unlimited.fix, /volatile-lru/);
  assert.doesNotMatch(unlimited.fix, /Set maxmemory-policy to allkeys-lru/);

  const rejects = evaluate('perf.redis-noeviction', {
    'redis-config': { maxmemoryBytes: 512 * 1024 * 1024, maxmemoryPolicy: 'noeviction' },
  });
  assert.match(rejects.fix, /volatile-lru/);
});

test('redis eviction policy: unlimited and noeviction are distinct findings', () => {
  const unlimited = evaluate('perf.redis-no-maxmemory', {
    'redis-config': { maxmemoryBytes: 0, maxmemoryPolicy: 'noeviction' },
  });
  assert.ok(unlimited);

  // A limit with noeviction is worse: it errors on write instead of evicting.
  const rejects = evaluate('perf.redis-noeviction', {
    'redis-config': { maxmemoryBytes: 512 * 1024 * 1024, maxmemoryPolicy: 'noeviction' },
  });
  assert.equal(rejects.severity, 'high');

  const healthy = evaluate('perf.redis-noeviction', {
    'redis-config': { maxmemoryBytes: 512 * 1024 * 1024, maxmemoryPolicy: 'allkeys-lru' },
  });
  assert.equal(healthy, null);
});

test('a real scan reports deployed-only rules as skipped on a local host', async () => {
  const scan = await hostAdvisorService.scan();

  assert.ok(Array.isArray(scan.findings));
  assert.equal(typeof scan.counts.passed, 'number');

  const deployedRules = ALL_RULES.filter((r) => r.scope === 'deployed').map((r) => r.id);
  const findingIds = new Set(scan.findings.map((f) => f.id));

  if (!scan.host.deployed) {
    for (const id of deployedRules) {
      assert.ok(!findingIds.has(id), `${id} must not fire on a local host`);
      const skip = scan.skipped.find((s) => s.id === id);
      assert.ok(skip, `${id} must be reported as skipped, not silently dropped`);
      assert.equal(skip.reason, 'not-applicable-local');
    }
  }

  // Every rule is accounted for exactly once: it fired, it passed, or it was
  // skipped. A rule that vanishes would make "no findings" a false statement.
  const accounted = scan.findings.length + scan.skipped.length + scan.counts.passed;
  assert.equal(accounted, ALL_RULES.length);
});

test('scan never leaks a raw secret value', async () => {
  const scan = await hostAdvisorService.scan();
  const serialized = JSON.stringify(scan);
  const jwtSecret = process.env.JWT_SECRET ?? '';
  if (jwtSecret.length > 8) {
    assert.ok(!serialized.includes(jwtSecret), 'JWT_SECRET must never appear in scan output');
  }
});

test('redactValue keeps a value identifiable without exposing it', () => {
  const out = redactValue('super-secret-value-1234');
  assert.ok(!out.includes('secret-value'));
  assert.match(out, /23 chars/);
  assert.equal(redactValue('short'), '***');
});

// The scan opens Postgres and Redis connections through the shared clients.
// Without this the test process stays alive after the last assertion and the
// runner appears to hang rather than fail.
after(async () => {
  await disconnectDb().catch(() => {});
  await disconnectRedis().catch(() => {});
});
