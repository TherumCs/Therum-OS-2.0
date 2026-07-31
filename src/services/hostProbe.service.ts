import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { statfs, stat, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { env } from '../lib/env.js';

const execFileAsync = promisify(execFile);

// Probes read the host. They are the ONLY thing that touches the machine, and
// the model never reaches this layer — it names a probe, the registry runs a
// fixed implementation. There is no path by which a model-supplied string
// becomes a command.
//
// Most probes need no subprocess at all: Node's own `os`, an already-open
// Prisma/Redis connection, and an HTTP request to our own server answer the
// large majority. That is deliberate beyond just safety — `free`, `ss` and
// `systemctl` do not exist on macOS, so an exec-first design would have meant
// a probe set that only worked on the VPS Bam does not have yet. In-process
// inspection runs identically on the laptop and the server.

export type Axis = 'security' | 'compression' | 'performance' | 'inventory';

/** 'deployed' probes are meaningless on a dev laptop — see hostAdvisor. */
export type HostScope = 'any' | 'deployed';

export interface Probe {
  id: string;
  axis: Axis;
  label: string;
  scope: HostScope;
  run(): Promise<Record<string, unknown>>;
}

export interface ProbeResult {
  id: string;
  axis: Axis;
  ok: boolean;
  /** Present when ok; shape is probe-specific and consumed by rules. */
  data?: Record<string, unknown>;
  /** Present when the probe could not run — NOT a finding, just missing input. */
  error?: string;
}

const PROBE_TIMEOUT_MS = 5000;

/** execFile with a hard timeout and no shell. Missing binary is not an error
 *  worth throwing over — a probe that cannot run yields `null` and the rules
 *  that depend on it simply do not evaluate. */
async function tryExec(bin: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(bin, args, { timeout: PROBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  } catch {
    return null;
  }
}

/** Secrets must never reach the payload that leaves this process — redaction
 *  belongs here, at the point of capture, not at the point of display. */
export function redactValue(v: string): string {
  if (v.length <= 8) return '***';
  return `${v.slice(0, 4)}…${v.slice(-2)} (${v.length} chars)`;
}

function isLoopback(addr: string): boolean {
  return (
    addr.startsWith('127.') ||
    addr === '::1' ||
    addr === 'localhost' ||
    addr.startsWith('[::1]') ||
    addr.startsWith('unix:')
  );
}

/** Host of a URL-ish connection string, without dragging in credentials. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname || 'unknown';
  } catch {
    return 'unparseable';
  }
}

const repoRoot = process.cwd();

export const PROBES: Probe[] = [
  {
    id: 'os',
    axis: 'inventory',
    label: 'Operating system',
    scope: 'any',
    run: async () => ({
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      // Whether this is a dev laptop or a server decides which rules apply at
      // all. Darwin is never a deployment target for this stack.
      deployed: os.platform() === 'linux',
      hostname: os.hostname(),
      uptimeSeconds: Math.round(os.uptime()),
    }),
  },
  {
    id: 'cpu',
    axis: 'performance',
    label: 'CPU and load',
    scope: 'any',
    run: async () => {
      const cpus = os.cpus();
      const [one = 0, five = 0, fifteen = 0] = os.loadavg();
      return {
        cores: cpus.length,
        model: cpus[0]?.model ?? 'unknown',
        load1: one,
        load5: five,
        load15: fifteen,
        // Load is only meaningful relative to core count.
        loadPerCore: cpus.length ? Number((one / cpus.length).toFixed(2)) : 0,
      };
    },
  },
  {
    id: 'memory',
    axis: 'performance',
    label: 'Memory',
    scope: 'any',
    run: async () => {
      const total = os.totalmem();
      const free = os.freemem();
      // os.freemem() counts only genuinely unused pages, which is the wrong
      // number on both platforms: macOS deliberately keeps it near zero by
      // using spare RAM as cache, and Linux excludes reclaimable buff/cache
      // too. Using it directly reported "99.6% of 32 GB in use" on an idle
      // laptop. MemAvailable is the kernel's own estimate of what a new
      // allocation could actually get, so on Linux that is the honest figure;
      // on anything else this stays null and the pressure rule does not run.
      let availableBytes: number | null = null;
      if (os.platform() === 'linux') {
        const meminfo = await readFile('/proc/meminfo', 'utf8').catch(() => null);
        const kb = meminfo ? Number(/MemAvailable:\s+(\d+)\s+kB/.exec(meminfo)?.[1] ?? 0) : 0;
        if (kb > 0) availableBytes = kb * 1024;
      }
      return {
        totalBytes: total,
        freeBytes: free,
        availableBytes,
        availablePct: availableBytes === null ? null : Number(((availableBytes / total) * 100).toFixed(1)),
        totalGb: Number((total / 1024 ** 3).toFixed(1)),
      };
    },
  },
  {
    id: 'disk',
    axis: 'performance',
    label: 'Disk',
    scope: 'any',
    run: async () => {
      const s = await statfs(repoRoot);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      return {
        totalBytes: total,
        freeBytes: free,
        usedPct: total ? Number((((total - free) / total) * 100).toFixed(1)) : 0,
        freeGb: Number((free / 1024 ** 3).toFixed(1)),
      };
    },
  },
  {
    id: 'node-process',
    axis: 'performance',
    label: 'Node process',
    scope: 'any',
    run: async () => {
      const mem = process.memoryUsage();
      return {
        nodeVersion: process.version,
        // Major version drives the "are you on a supported runtime" rule.
        nodeMajor: Number(process.version.replace('v', '').split('.')[0]),
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
        uptimeSeconds: Math.round(process.uptime()),
        cores: os.cpus().length,
        nodeEnv: process.env.NODE_ENV ?? 'undefined',
      };
    },
  },
  {
    id: 'service-binding',
    axis: 'security',
    label: 'Datastore binding',
    scope: 'any',
    run: async () => {
      const dbHost = hostOf(env.DATABASE_URL);
      const redisHost = hostOf(env.REDIS_URL);
      return {
        databaseHost: dbHost,
        databaseLoopback: isLoopback(dbHost),
        redisHost,
        redisLoopback: isLoopback(redisHost),
      };
    },
  },
  {
    id: 'secrets',
    axis: 'security',
    label: 'Secret strength and exposure',
    scope: 'any',
    run: async () => {
      const jwt = process.env.JWT_SECRET ?? '';
      const credKey = process.env.CREDENTIAL_KEY ?? '';
      // The literal placeholders shipped in .env.example. A live install still
      // running one of these is the single worst finding this tool can make:
      // the signing secret is public, so anyone can mint an admin token.
      const placeholders = ['change-me', 'changeme', 'dev-secret', 'secret', 'please-change'];
      const looksPlaceholder = (v: string): boolean =>
        placeholders.some((p) => v.toLowerCase().includes(p));
      return {
        jwtLength: jwt.length,
        jwtPlaceholder: looksPlaceholder(jwt),
        credentialKeyLength: credKey.length,
        credentialKeyPlaceholder: looksPlaceholder(credKey),
        corsOrigin: process.env.CORS_ORIGIN ?? '',
      };
    },
  },
  {
    id: 'file-perms',
    axis: 'security',
    label: 'Secret file permissions',
    scope: 'any',
    run: async () => {
      const files = ['.env', 'admin/.env'];
      const out: Record<string, unknown>[] = [];
      for (const rel of files) {
        const p = join(repoRoot, rel);
        if (!existsSync(p)) continue;
        const s = await stat(p);
        const mode = s.mode & 0o777;
        out.push({
          file: rel,
          mode: mode.toString(8).padStart(3, '0'),
          // Any bit set for group or other on a file holding the signing
          // secret is a finding.
          groupOrOtherReadable: (mode & 0o077) !== 0,
        });
      }
      return { files: out };
    },
  },
  {
    id: 'git-secrets',
    axis: 'security',
    label: 'Secrets in version control',
    scope: 'any',
    run: async () => {
      const out = await tryExec('git', ['ls-files']);
      if (out === null) return { available: false, tracked: [] };
      // .env.example is the one that SHOULD be tracked; anything else matching
      // env is a real leak, and deleting it later does not help because
      // scrapers find pushed keys within minutes.
      const tracked = out
        .split('\n')
        .filter((f) => /(^|\/)\.env($|\.)/.test(f))
        .filter((f) => !f.endsWith('.example'));
      return { available: true, tracked };
    },
  },
  {
    id: 'postgres-config',
    axis: 'performance',
    label: 'PostgreSQL configuration',
    scope: 'any',
    run: async () => {
      // Through the existing pooled connection — no psql binary needed, so
      // this works identically against a container, a socket, or a managed
      // instance.
      const rows = await db.$queryRawUnsafe<{ name: string; setting: string; unit: string | null }[]>(
        `SELECT name, setting, unit FROM pg_settings
          WHERE name IN ('shared_buffers','work_mem','effective_cache_size','max_connections','maintenance_work_mem','random_page_cost')`,
      );
      const cfg: Record<string, { setting: string; unit: string | null }> = {};
      for (const r of rows) cfg[r.name] = { setting: r.setting, unit: r.unit };
      const conn = await db.$queryRawUnsafe<{ count: bigint }[]>(
        'SELECT count(*)::bigint AS count FROM pg_stat_activity',
      );
      const ver = await db.$queryRawUnsafe<{ server_version: string }[]>('SHOW server_version');
      const count = conn[0]?.count ?? 0n;
      const version = ver[0]?.server_version ?? 'unknown';
      return {
        settings: cfg,
        activeConnections: Number(count),
        serverVersion: version,
        serverMajor: Number(String(version).split('.')[0]),
        totalMemBytes: os.totalmem(),
      };
    },
  },
  {
    id: 'postgres-indexes',
    axis: 'performance',
    label: 'Unindexed foreign keys',
    scope: 'any',
    run: async () => {
      // A foreign key with no index makes every cascading delete and every
      // join on it a sequential scan. Cheap to find, expensive to leave.
      const rows = await db.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
        `SELECT c.conrelid::regclass::text AS table_name,
                a.attname AS column_name
           FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.contype = 'f'
            AND NOT EXISTS (
              SELECT 1 FROM pg_index i
               WHERE i.indrelid = c.conrelid
                 AND a.attnum = i.indkey[0]
            )
          ORDER BY 1, 2`,
      );
      return { missing: rows };
    },
  },
  {
    id: 'redis-config',
    axis: 'performance',
    label: 'Redis configuration',
    scope: 'any',
    run: async () => {
      const maxmemory = (await redis.config('GET', 'maxmemory')) as string[];
      const policy = (await redis.config('GET', 'maxmemory-policy')) as string[];
      const info = await redis.info('stats');
      const hits = Number(/keyspace_hits:(\d+)/.exec(info)?.[1] ?? 0);
      const misses = Number(/keyspace_misses:(\d+)/.exec(info)?.[1] ?? 0);
      const total = hits + misses;
      return {
        maxmemoryBytes: Number(maxmemory?.[1] ?? 0),
        maxmemoryPolicy: policy?.[1] ?? 'unknown',
        keyspaceHits: hits,
        keyspaceMisses: misses,
        // Below ~80% usually means the cache is too small or keys expire too
        // fast to earn their keep. Meaningless until there is real traffic.
        hitRatePct: total > 0 ? Number(((hits / total) * 100).toFixed(1)) : null,
      };
    },
  },
  {
    id: 'http-response',
    axis: 'compression',
    label: 'Response headers and compression',
    scope: 'any',
    run: async () => {
      // Asks the running server for a real page, exactly as a browser would,
      // and reads what came back. This is the only honest way to check
      // compression: nginx config can say `gzip on` and still not compress a
      // proxied response (that is the `gzip_proxied` trap this stack already
      // hit once).
      const base = `http://127.0.0.1:${env.PORT}`;
      const probeOne = async (path: string): Promise<Record<string, unknown>> => {
        const res = await fetch(`${base}${path}`, {
          headers: { 'accept-encoding': 'gzip, br', accept: 'text/html,*/*' },
          redirect: 'manual',
        });
        const body = await res.arrayBuffer();
        const h = (n: string): string | null => res.headers.get(n);
        return {
          path,
          status: res.status,
          contentEncoding: h('content-encoding'),
          contentType: h('content-type'),
          bytes: body.byteLength,
          cacheControl: h('cache-control'),
          etag: h('etag') ? 'present' : null,
          hsts: h('strict-transport-security'),
          csp: h('content-security-policy'),
          xContentTypeOptions: h('x-content-type-options'),
          referrerPolicy: h('referrer-policy'),
          permissionsPolicy: h('permissions-policy'),
          xFrameOptions: h('x-frame-options'),
          poweredBy: h('x-powered-by'),
          server: h('server'),
        };
      };
      const html = await probeOne('/');
      return { html };
    },
  },
  {
    id: 'listening-ports',
    axis: 'security',
    label: 'Listening ports',
    scope: 'deployed',
    run: async () => {
      // Linux only, and deployed-only by scope — `ss` is not on macOS and the
      // question "what is exposed" is not meaningful on a laptop behind NAT.
      const out = await tryExec('ss', ['-tlnH']);
      if (out === null) return { available: false, listeners: [] };
      const listeners = out
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const cols = line.trim().split(/\s+/);
          const local = cols[3] ?? '';
          const addr = local.replace(/:(\d+)$/, '');
          const port = Number(/:(\d+)$/.exec(local)?.[1] ?? 0);
          return { address: addr, port, worldReachable: addr === '0.0.0.0' || addr === '*' || addr === '[::]' };
        })
        .filter((l) => l.port > 0);
      return { available: true, listeners };
    },
  },
  {
    id: 'pending-updates',
    axis: 'security',
    label: 'Pending security updates',
    scope: 'deployed',
    run: async () => {
      const out = await tryExec('apt-get', ['-s', '-o', 'Debug::NoLocking=1', 'upgrade']);
      if (out === null) return { available: false, security: 0, total: 0 };
      const lines = out.split('\n').filter((l) => l.startsWith('Inst '));
      return {
        available: true,
        total: lines.length,
        security: lines.filter((l) => /security/i.test(l)).length,
      };
    },
  },
  {
    id: 'tls',
    axis: 'security',
    label: 'TLS certificate',
    scope: 'deployed',
    run: async () => {
      const dir = '/etc/letsencrypt/live';
      if (!existsSync(dir)) return { available: false, certificates: [] };
      const out = await tryExec('find', [dir, '-name', 'cert.pem', '-maxdepth', '2']);
      if (out === null) return { available: false, certificates: [] };
      const certs: Record<string, unknown>[] = [];
      for (const path of out.split('\n').filter(Boolean)) {
        const pem = await readFile(path, 'utf8').catch(() => null);
        if (!pem) continue;
        const notAfter = await tryExec('openssl', ['x509', '-enddate', '-noout', '-in', path]);
        const raw = notAfter?.replace('notAfter=', '').trim();
        const expires = raw ? new Date(raw) : null;
        certs.push({
          path,
          expiresAt: expires && !Number.isNaN(expires.getTime()) ? expires.toISOString() : null,
          daysRemaining:
            expires && !Number.isNaN(expires.getTime())
              ? Math.round((expires.getTime() - Date.now()) / 86400000)
              : null,
        });
      }
      return { available: true, certificates: certs };
    },
  },
  {
    id: 'firewall',
    axis: 'security',
    label: 'Firewall',
    scope: 'deployed',
    run: async () => {
      const ufw = await tryExec('ufw', ['status']);
      if (ufw !== null) return { available: true, tool: 'ufw', active: /Status:\s*active/i.test(ufw) };
      const nft = await tryExec('nft', ['list', 'ruleset']);
      if (nft !== null) return { available: true, tool: 'nftables', active: nft.trim().length > 0 };
      return { available: false, tool: null, active: false };
    },
  },
  {
    id: 'ssh-config',
    axis: 'security',
    label: 'SSH daemon configuration',
    scope: 'deployed',
    run: async () => {
      const path = '/etc/ssh/sshd_config';
      if (!existsSync(path)) return { available: false };
      const text = await readFile(path, 'utf8').catch(() => null);
      if (text === null) return { available: false };
      // Only the three directives that matter are extracted — the file can
      // carry key paths and host names, and none of that needs to leave here.
      const directive = (name: string): string | null => {
        const m = new RegExp(`^\\s*${name}\\s+(\\S+)`, 'im').exec(text);
        return m ? m[1]!.toLowerCase() : null;
      };
      return {
        available: true,
        permitRootLogin: directive('PermitRootLogin'),
        passwordAuthentication: directive('PasswordAuthentication'),
        port: directive('Port'),
      };
    },
  },
];

export function probeById(id: string): Probe | undefined {
  return PROBES.find((p) => p.id === id);
}

/** Runs probes in parallel. A probe that throws yields an error result rather
 *  than failing the scan — a missing binary must never look like a finding. */
export async function runProbes(ids?: string[]): Promise<ProbeResult[]> {
  const selected = ids?.length ? PROBES.filter((p) => ids.includes(p.id)) : PROBES;
  return Promise.all(
    selected.map(async (p): Promise<ProbeResult> => {
      try {
        return { id: p.id, axis: p.axis, ok: true, data: await p.run() };
      } catch (e) {
        return { id: p.id, axis: p.axis, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
}
