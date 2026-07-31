import type { Rule } from './types.js';
import { gb, mb, num, pgBytes, str } from './types.js';

// Performance thresholds are RELATIVE — a fraction of the host's own RAM, load
// per core, percentage of disk — never a value tuned to one machine. Bam has
// no VPS yet, so a rule pinned to "16 GB" would be wrong on the laptop today
// and wrong again on whatever gets bought.

export const performanceRules: Rule[] = [
  {
    id: 'perf.disk-full',
    axis: 'performance',
    scope: 'any',
    probes: ['disk'],
    evaluate: (d) => {
      const disk = d['disk']!;
      const used = num(disk['usedPct']);
      if (used < 85) return null;
      return {
        id: 'perf.disk-full',
        axis: 'performance',
        severity: used >= 95 ? 'critical' : 'high',
        title: 'Disk is nearly full',
        detail: `${used}% used, ${num(disk['freeGb'])} GB free.`,
        why:
          'Postgres stops accepting writes when it cannot extend a file, and the failure mode is a hard outage, ' +
          'not a slowdown. Uploads and backups are usually what fill it.',
        fix: 'Clear old backups and unreferenced uploads first, then check Postgres WAL size. Grow the volume if the working set genuinely needs it.',
      };
    },
  },
  {
    id: 'perf.memory-pressure',
    axis: 'performance',
    // Deployed-only because MemAvailable is the only trustworthy input and it
    // is Linux-only. The first version of this rule used os.freemem() and
    // reported 99.6% pressure on an idle 32 GB laptop, because macOS keeps
    // free memory near zero on purpose — a rule that fires on a healthy host
    // trains you to ignore the whole report.
    scope: 'deployed',
    probes: ['memory'],
    evaluate: (d) => {
      const m = d['memory']!;
      const availablePct = m['availablePct'];
      if (typeof availablePct !== 'number') return null;
      const used = Number((100 - availablePct).toFixed(1));
      if (used < 90) return null;
      return {
        id: 'perf.memory-pressure',
        axis: 'performance',
        severity: used >= 96 ? 'high' : 'medium',
        title: 'Memory is under pressure',
        detail: `${used}% of ${num(m['totalGb'])} GB committed (MemAvailable ${availablePct}%).`,
        why: 'Once the host starts swapping, latency rises across every service at once and the cause is hard to see from inside the app.',
        fix: 'Check what is resident. On this stack the usual candidates are the Postgres shared buffers and Node heap being sized for a bigger box than this one.',
      };
    },
  },
  {
    id: 'perf.load',
    axis: 'performance',
    scope: 'any',
    probes: ['cpu'],
    evaluate: (d) => {
      const c = d['cpu']!;
      const perCore = num(c['loadPerCore']);
      if (perCore < 1.5) return null;
      return {
        id: 'perf.load',
        axis: 'performance',
        severity: perCore >= 3 ? 'high' : 'medium',
        title: 'Sustained CPU load above capacity',
        detail: `1-minute load ${num(c['load1'])} across ${num(c['cores'])} cores (${perCore} per core).`,
        why: 'Load above 1.0 per core means work is queuing rather than running. Requests wait even though nothing is broken.',
        fix: 'Identify the busy process before adding cores — on this stack a runaway import worker or an unindexed query is more likely than genuine traffic.',
      };
    },
  },
  {
    id: 'perf.pg-shared-buffers',
    axis: 'performance',
    scope: 'any',
    probes: ['postgres-config'],
    evaluate: (d) => {
      const p = d['postgres-config']!;
      const settings = p['settings'] as Record<string, { setting: string; unit: string | null }>;
      const sb = settings['shared_buffers'];
      if (!sb) return null;
      const bytes = pgBytes(sb.setting, sb.unit);
      const total = num(p['totalMemBytes']);
      if (!total || !bytes) return null;
      const pct = (bytes / total) * 100;
      // The long-standing guidance is ~25% of system RAM. Only flag when it is
      // far below that AND the absolute number is small — a deliberately
      // tuned instance should not be nagged.
      if (pct >= 15 || bytes >= 1024 ** 3) return null;
      return {
        id: 'perf.pg-shared-buffers',
        axis: 'performance',
        severity: 'medium',
        title: 'PostgreSQL shared_buffers is small for this host',
        detail: `shared_buffers is ${mb(bytes)} (${pct.toFixed(1)}% of ${gb(total)} RAM).`,
        why:
          'shared_buffers is the database\'s own page cache. At the default 128 MB it re-reads from the OS ' +
          'constantly, which shows up as slow queries that EXPLAIN says should be fast.',
        fix: `Set shared_buffers to roughly 25% of RAM (about ${mb(total * 0.25)} here) and restart Postgres. Raise effective_cache_size to ~50-75% at the same time; that one is a hint, not an allocation.`,
      };
    },
  },
  {
    id: 'perf.pg-connections',
    axis: 'performance',
    scope: 'any',
    probes: ['postgres-config'],
    evaluate: (d) => {
      const p = d['postgres-config']!;
      const settings = p['settings'] as Record<string, { setting: string; unit: string | null }>;
      const max = Number(settings['max_connections']?.setting ?? 0);
      const active = num(p['activeConnections']);
      if (!max) return null;
      const pct = (active / max) * 100;
      if (pct < 70) return null;
      return {
        id: 'perf.pg-connections',
        axis: 'performance',
        severity: pct >= 90 ? 'high' : 'medium',
        title: 'PostgreSQL connection pool is close to its limit',
        detail: `${active} of ${max} connections in use (${pct.toFixed(0)}%).`,
        why: 'Exhausting max_connections rejects new connections outright — the app returns errors rather than running slowly.',
        fix: 'Lower the Prisma pool size or put PgBouncer in front. Raising max_connections trades one problem for memory pressure, since each backend has its own allocation.',
      };
    },
  },
  {
    id: 'perf.pg-missing-fk-index',
    axis: 'performance',
    scope: 'any',
    probes: ['postgres-indexes'],
    evaluate: (d) => {
      const missing = (d['postgres-indexes']!['missing'] as Record<string, unknown>[]) ?? [];
      if (missing.length === 0) return null;
      const shown = missing.slice(0, 8).map((m) => `${str(m['table_name'])}.${str(m['column_name'])}`);
      return {
        id: 'perf.pg-missing-fk-index',
        axis: 'performance',
        severity: missing.length > 10 ? 'medium' : 'low',
        title: 'Foreign keys without a supporting index',
        detail: `${missing.length} found: ${shown.join(', ')}${missing.length > shown.length ? ', …' : ''}`,
        why:
          'Postgres does not index foreign keys automatically. Every join and every cascading delete on these ' +
          'columns is a sequential scan, which stays invisible until the table is big enough to hurt.',
        fix: shown.length
          ? `CREATE INDEX CONCURRENTLY ON ${str(missing[0]!['table_name'])} (${str(missing[0]!['column_name'])});  — repeat per column. CONCURRENTLY avoids locking the table.`
          : '',
      };
    },
  },
  {
    id: 'perf.redis-no-maxmemory',
    axis: 'performance',
    scope: 'any',
    probes: ['redis-config'],
    evaluate: (d) => {
      const r = d['redis-config']!;
      if (num(r['maxmemoryBytes']) !== 0) return null;
      return {
        id: 'perf.redis-no-maxmemory',
        axis: 'performance',
        severity: 'medium',
        title: 'Redis has no memory limit',
        detail: `maxmemory is 0 (unlimited), policy "${str(r['maxmemoryPolicy'])}".`,
        why:
          'With no ceiling Redis grows until the host runs out of memory, and the OOM killer usually takes ' +
          'Postgres or Node rather than Redis. A cache should shed keys, not take the box down.',
        fix: 'Set maxmemory to a fixed share of RAM and maxmemory-policy to allkeys-lru, so it evicts instead of growing.',
      };
    },
  },
  {
    id: 'perf.redis-noeviction',
    axis: 'performance',
    scope: 'any',
    probes: ['redis-config'],
    evaluate: (d) => {
      const r = d['redis-config']!;
      if (num(r['maxmemoryBytes']) === 0) return null;
      if (str(r['maxmemoryPolicy']) !== 'noeviction') return null;
      return {
        id: 'perf.redis-noeviction',
        axis: 'performance',
        severity: 'high',
        title: 'Redis will reject writes when full',
        detail: 'maxmemory is set but maxmemory-policy is "noeviction".',
        why: 'At the limit Redis starts returning errors on write instead of evicting. For a cache that turns a soft limit into an outage.',
        fix: 'CONFIG SET maxmemory-policy allkeys-lru, and persist it in redis.conf.',
      };
    },
  },
  {
    id: 'perf.node-version',
    axis: 'performance',
    scope: 'any',
    probes: ['node-process'],
    evaluate: (d) => {
      const major = num(d['node-process']!['nodeMajor']);
      if (major === 0 || major >= 20) return null;
      return {
        id: 'perf.node-version',
        axis: 'performance',
        severity: 'medium',
        title: 'Node.js is past its maintenance window',
        detail: `Running Node ${str(d['node-process']!['nodeVersion'])}.`,
        why: 'Versions below 20 no longer receive security patches, and this codebase already relies on newer built-ins such as fs.statfs.',
        fix: 'Move to the current Node LTS. Check the release schedule for what that is today rather than assuming a number.',
      };
    },
  },
];
