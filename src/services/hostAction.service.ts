import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { env } from '../lib/env.js';
import type { HostScope } from './hostProbe.service.js';

const execFileAsync = promisify(execFile);

// Actions are the Host Advisor's hands.
//
// The advisor reads the box and tells you what is wrong. Until now the fix was
// a string you copied into a terminal. This runs it — but ONLY from the fixed
// list below, and that constraint is the entire security design:
//
//   * There is no endpoint that takes a command. Not a filtered one, not an
//     escaped one, not an "advanced mode". A caller names an action id; the
//     registry runs an implementation written here. No request value ever
//     becomes part of an argv.
//   * `execFile`, never a shell. No string is parsed, so quoting, `;`, `$()`
//     and newlines are inert rather than "handled".
//   * Every run is logged with its actor, the exact command, and its output.
//   * Anything that can lock you out validates BEFORE it commits and rolls
//     itself back if the validation fails — see `ssh.disable-passwords`.
//
// Adding a capability means adding an entry here, in a reviewed commit. That
// is slower than a terminal on purpose: a web shell in an admin panel is one
// stolen session away from being the attacker's shell.

export type ActionGroup = 'service' | 'security' | 'tuning' | 'logs';

/** How much a run can disturb: 'read' changes nothing, 'restart' interrupts
 *  briefly, 'sensitive' can lock you out or change what the box accepts. */
export type ActionRisk = 'read' | 'restart' | 'sensitive';

export interface HostAction {
  id: string;
  group: ActionGroup;
  label: string;
  /** What it does, in a sentence an operator can act on. */
  description: string;
  /** Shown before running, and recorded. Not built from any input. */
  command: string;
  risk: ActionRisk;
  scope: HostScope;
  /** Advisor rule ids this resolves, so a finding can offer its own fix. */
  fixes: string[];
  /** How to undo it, in words. Every sensitive action must answer this. */
  revert: string;
  run(): Promise<string>;
}

export interface ActionRunResult {
  id: string;
  ok: boolean;
  dryRun: boolean;
  command: string;
  output: string;
  durationMs: number;
}

const ACTION_TIMEOUT_MS = 180_000; // apt upgrade is genuinely slow
const MAX_OUTPUT = 8_000;

/** Values that must never survive into a log row or an HTTP response, even if
 *  some command decides to echo the environment back at us. */
function scrub(text: string): string {
  let out = text;
  for (const secret of [env.JWT_SECRET, env.CREDENTIAL_KEY, env.WEBHOOK_SECRET, env.DATABASE_URL]) {
    if (typeof secret === 'string' && secret.length >= 8) out = out.split(secret).join('«redacted»');
  }
  return out.length > MAX_OUTPUT ? `${out.slice(0, MAX_OUTPUT)}\n… (truncated)` : out;
}

/** Run a fixed binary with fixed arguments. No shell, no interpolation. */
async function exec(bin: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(bin, args, {
    timeout: ACTION_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
  });
  return [stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)';
}

/**
 * The same, through sudo.
 *
 * The API does not run as root and must not: a web process with root is the
 * thing every one of these actions is trying to protect. Instead the box grants
 * this user NOPASSWD on EXACTLY the argv listed in `deploy/therum-sudoers` —
 * not on a binary, on the full command line. `sudo -n` never prompts, so a
 * missing grant surfaces as a clear failure instead of a request that hangs
 * until the HTTP timeout waiting for a password nobody can type.
 */
async function sudo(bin: string, args: string[]): Promise<string> {
  try {
    return await exec('sudo', ['-n', bin, ...args]);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/a password is required|sudo:|not allowed/i.test(message)) {
      throw new Error(
        `sudo refused "${bin} ${args.join(' ')}". Install deploy/therum-sudoers on the box (see VPS-CHECKLIST §1) — the panel is deliberately not root.`,
      );
    }
    throw e;
  }
}

/** A quarter of RAM, the standard starting point for both Postgres and Redis. */
function quarterOfRamMb(): number {
  return Math.max(128, Math.floor(os.totalmem() / 1024 / 1024 / 4));
}

const SSHD_CONFIG = '/etc/ssh/sshd_config';

export const HOST_ACTIONS: HostAction[] = [
  // ── Services ───────────────────────────────────────────────────────────
  {
    id: 'pm2.status',
    group: 'service',
    label: 'Process status',
    description: 'What PM2 is running, and how much memory each process holds.',
    command: 'pm2 jlist',
    risk: 'read',
    scope: 'deployed',
    fixes: [],
    revert: 'Reads only.',
    run: () => exec('pm2', ['jlist']),
  },
  {
    id: 'pm2.reload-api',
    group: 'service',
    label: 'Reload the API',
    description: 'Zero-downtime cluster reload. Use after deploying code.',
    command: 'pm2 reload therum-cms-api',
    risk: 'restart',
    scope: 'deployed',
    fixes: [],
    revert: 'Nothing to undo — it restarts the same code that was on disk.',
    run: () => exec('pm2', ['reload', 'therum-cms-api']),
  },
  {
    id: 'pm2.restart-admin',
    group: 'service',
    label: 'Restart the admin',
    description: 'Next.js runs single-instance, so this is a restart, not a reload — expect a second of downtime on /tos-admin.',
    command: 'pm2 restart therum-cms-admin',
    risk: 'restart',
    scope: 'deployed',
    fixes: [],
    revert: 'Nothing to undo.',
    run: () => exec('pm2', ['restart', 'therum-cms-admin']),
  },
  {
    id: 'pm2.restart-worker',
    group: 'service',
    label: 'Restart the worker',
    description: 'The queue worker. Restart it when imports stop draining.',
    command: 'pm2 restart therum-cms-worker',
    risk: 'restart',
    scope: 'deployed',
    fixes: [],
    revert: 'Nothing to undo. In-flight jobs return to the queue.',
    run: () => exec('pm2', ['restart', 'therum-cms-worker']),
  },
  {
    id: 'nginx.test',
    group: 'service',
    label: 'Test the nginx config',
    description: 'Parses the config without loading it. Always run this before a reload.',
    command: 'nginx -t',
    risk: 'read',
    scope: 'deployed',
    fixes: [],
    revert: 'Reads only.',
    run: () => sudo('nginx', ['-t']),
  },
  {
    id: 'nginx.reload',
    group: 'service',
    label: 'Reload nginx',
    description: 'Applies a changed config without dropping connections. Tests first and refuses if the config is broken.',
    command: 'nginx -t && systemctl reload nginx',
    risk: 'restart',
    scope: 'deployed',
    fixes: [],
    revert: 'Restore the previous config file and reload again.',
    async run() {
      // The test is not advice here, it is a gate: reloading a broken config
      // is how a working site goes down during a routine change.
      const test = await sudo('nginx', ['-t']);
      const reload = await sudo('systemctl', ['reload', 'nginx']);
      return `${test}\n${reload}`;
    },
  },

  // ── Security ───────────────────────────────────────────────────────────
  {
    id: 'ufw.deny-incoming',
    group: 'security',
    label: 'Default-deny incoming',
    description: 'Sets the firewall default. Run this BEFORE enabling the firewall, and make sure SSH is already allowed.',
    command: 'ufw default deny incoming',
    risk: 'sensitive',
    scope: 'deployed',
    fixes: ['sec.firewall', 'sec.exposed-ports'],
    revert: 'ufw default allow incoming',
    run: () => sudo('ufw', ['default', 'deny', 'incoming']),
  },
  {
    id: 'ufw.enable',
    group: 'security',
    label: 'Enable the firewall',
    description: 'Turns ufw on. Allows OpenSSH first, because enabling a default-deny firewall without it ends the session you are reading this in.',
    command: 'ufw allow OpenSSH && ufw --force enable',
    risk: 'sensitive',
    scope: 'deployed',
    fixes: ['sec.firewall'],
    revert: 'ufw disable',
    async run() {
      const allow = await sudo('ufw', ['allow', 'OpenSSH']);
      const on = await sudo('ufw', ['--force', 'enable']);
      return `${allow}\n${on}`;
    },
  },
  {
    id: 'ssh.disable-passwords',
    group: 'security',
    label: 'Disable SSH passwords',
    description: 'Key-only login. Validates the new config and puts the old one back if it does not parse — the failure mode this guards against is being locked out of your own box.',
    command: 'sed -i.therum-bak s/^#\\?PasswordAuthentication.*/PasswordAuthentication no/ /etc/ssh/sshd_config && sshd -t && systemctl reload ssh',
    risk: 'sensitive',
    scope: 'deployed',
    fixes: ['sec.ssh-password'],
    revert: `Restore ${SSHD_CONFIG}.therum-bak and reload ssh.`,
    async run() {
      // Confirm a key is actually installed first. Turning off passwords on a
      // box you only ever password into is a locked door with the key inside.
      const keys = await readFile(`${os.homedir()}/.ssh/authorized_keys`, 'utf8').catch(() => '');
      if (keys.trim().length === 0) {
        throw new Error(
          'No authorized_keys for this user — refusing. Install your public key and confirm key login in a second terminal first.',
        );
      }
      // `cp` through sudo rather than fs.copyFile: /etc/ssh is root-owned, and
      // the whole point of this service is that it is not running as root.
      await sudo('cp', [SSHD_CONFIG, `${SSHD_CONFIG}.therum-bak`]);
      const edit = await sudo('sed', ['-i', 's/^#\\?PasswordAuthentication.*/PasswordAuthentication no/', SSHD_CONFIG]);
      try {
        await sudo('sshd', ['-t']);
      } catch (e) {
        await sudo('cp', [`${SSHD_CONFIG}.therum-bak`, SSHD_CONFIG]);
        throw new Error(`sshd rejected the edited config — rolled back, nothing changed. ${e instanceof Error ? e.message : String(e)}`);
      }
      const reload = await sudo('systemctl', ['reload', 'ssh']);
      return `${edit}\nconfig validated\n${reload}\nKeep your current session open until you have proved a NEW key login works.`;
    },
  },
  {
    id: 'apt.upgrade',
    group: 'security',
    label: 'Install pending updates',
    description: 'apt-get update then upgrade, non-interactive. Security patches are the finding that ages worst.',
    command: 'apt-get update && apt-get -y upgrade',
    risk: 'restart',
    scope: 'deployed',
    fixes: ['sec.updates'],
    revert: 'Package downgrades are manual. Read the output before assuming a service restarted cleanly.',
    async run() {
      const update = await sudo('apt-get', ['update']);
      const upgrade = await sudo('apt-get', ['-y', 'upgrade']);
      return `${update}\n${upgrade}`;
    },
  },
  {
    id: 'certbot.renew-dry-run',
    group: 'security',
    label: 'Test certificate renewal',
    description: 'Proves renewal will work before the certificate is close to expiring. Changes nothing.',
    command: 'certbot renew --dry-run',
    risk: 'read',
    scope: 'deployed',
    fixes: ['sec.tls-expiry'],
    revert: 'Dry run — nothing is written.',
    run: () => sudo('certbot', ['renew', '--dry-run']),
  },

  // ── Tuning ─────────────────────────────────────────────────────────────
  {
    id: 'redis.tune-memory',
    group: 'tuning',
    label: 'Cap Redis memory',
    description: 'Sets maxmemory to a quarter of RAM and the policy to volatile-lru, then rewrites the config so it survives a restart.',
    command: 'CONFIG SET maxmemory <25% of RAM> · CONFIG SET maxmemory-policy volatile-lru · CONFIG REWRITE',
    risk: 'restart',
    scope: 'any',
    fixes: ['perf.redis-no-maxmemory', 'perf.redis-noeviction'],
    revert: 'CONFIG SET maxmemory 0 and maxmemory-policy noeviction, then CONFIG REWRITE.',
    async run() {
      const mb = quarterOfRamMb();
      await redis.config('SET', 'maxmemory', `${mb}mb`);
      // volatile-lru, NOT allkeys-lru. Carts and rate limits carry a TTL and
      // are safe to evict; BullMQ job data does not, and allkeys would drop
      // queued work under pressure with no error anywhere.
      await redis.config('SET', 'maxmemory-policy', 'volatile-lru');
      const rewrite = await redis.config('REWRITE').catch((e: unknown) => `CONFIG REWRITE failed (${String(e)}) — the setting is live but will not survive a restart.`);
      return `maxmemory ${mb}mb\nmaxmemory-policy volatile-lru\n${String(rewrite)}`;
    },
  },
  {
    id: 'postgres.tune-shared-buffers',
    group: 'tuning',
    label: 'Tune Postgres shared_buffers',
    description: 'ALTER SYSTEM to a quarter of RAM. Needs a Postgres RESTART to take effect — a reload will not do it.',
    command: "ALTER SYSTEM SET shared_buffers = '<25% of RAM>'",
    risk: 'sensitive',
    scope: 'any',
    fixes: ['perf.pg-shared-buffers'],
    revert: 'ALTER SYSTEM RESET shared_buffers, then restart Postgres.',
    async run() {
      const mb = quarterOfRamMb();
      // Interpolating a number this function computed, into a statement that
      // takes no user input. ALTER SYSTEM cannot be parameterised.
      await db.$executeRawUnsafe(`ALTER SYSTEM SET shared_buffers = '${mb}MB'`);
      return `shared_buffers staged at ${mb}MB. Restart Postgres to apply — 'systemctl restart postgresql'. Until then the running value is unchanged.`;
    },
  },

  // ── Logs ───────────────────────────────────────────────────────────────
  {
    id: 'logs.pm2',
    group: 'logs',
    label: 'Application log',
    description: 'The last 200 lines PM2 captured, across every process.',
    command: 'pm2 logs --nostream --lines 200',
    risk: 'read',
    scope: 'deployed',
    fixes: [],
    revert: 'Reads only.',
    run: () => exec('pm2', ['logs', '--nostream', '--lines', '200']),
  },
  {
    id: 'logs.nginx-error',
    group: 'logs',
    label: 'nginx error log',
    description: 'The last 200 lines of nginx errors — where a 502 explains itself.',
    command: 'tail -n 200 /var/log/nginx/error.log',
    risk: 'read',
    scope: 'deployed',
    fixes: [],
    revert: 'Reads only.',
    run: () => sudo('tail', ['-n', '200', '/var/log/nginx/error.log']),
  },
];

export function actionById(id: string): HostAction | undefined {
  return HOST_ACTIONS.find((a) => a.id === id);
}

export const hostActionService = {
  /** Every action, with whether this host can run it. */
  list(): (Omit<HostAction, 'run'> & { available: boolean })[] {
    const deployed = os.platform() === 'linux';
    return HOST_ACTIONS.map(({ run: _run, ...a }) => ({ ...a, available: a.scope === 'any' || deployed }));
  },

  /**
   * Run one action by id.
   *
   * `dryRun` returns the exact command without executing — the panel shows it
   * before asking for confirmation, so nobody approves a black box.
   */
  async run(id: string, opts: { dryRun?: boolean; actorId?: string | null } = {}): Promise<ActionRunResult> {
    const action = actionById(id);
    if (!action) throw new Error(`Unknown action "${id}".`);

    const deployed = os.platform() === 'linux';
    if (action.scope === 'deployed' && !deployed) {
      throw new Error(`"${action.label}" only exists on a Linux server — this host is ${os.platform()}.`);
    }

    const started = Date.now();
    if (opts.dryRun) {
      return { id, ok: true, dryRun: true, command: action.command, output: 'Dry run — nothing executed.', durationMs: 0 };
    }

    // WRITE-AHEAD. Some of these actions kill the process that would otherwise
    // write this row: `pm2 reload therum-cms-api` restarts this very server,
    // and apt-get can take services with it. Logging on completion meant the
    // most disruptive actions left no trace — the exact opposite of what an
    // audit log is for. The row exists before the command does anything.
    const row = await db.hostActionLog
      .create({ data: { actionId: id, actorId: opts.actorId ?? null, status: 'running' } })
      .catch(() => null);

    let ok = true;
    let output: string;
    try {
      output = scrub(await action.run());
    } catch (e) {
      ok = false;
      output = scrub(e instanceof Error ? e.message : String(e));
    }
    const durationMs = Date.now() - started;

    if (row) {
      await db.hostActionLog
        .update({
          where: { id: row.id },
          data: { status: ok ? 'ok' : 'failed', ok, output, durationMs, finishedAt: new Date() },
        })
        .catch(() => undefined);
    }

    return { id, ok, dryRun: false, command: action.command, output, durationMs };
  },

  /**
   * Close out rows left 'running' by a restart, and report how many.
   *
   * Called at boot. If the API is up and a row still says 'running', the run
   * that wrote it did not survive — either it restarted this process on
   * purpose or the box went down under it. Marked 'interrupted' rather than
   * ok or failed, because the honest answer is that nobody saw the end of it;
   * the operator checks the box. Anything still running from THIS process is
   * excluded by the age window.
   */
  async closeInterrupted(olderThanMs = 60_000): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const { count } = await db.hostActionLog
      .updateMany({
        where: { status: 'running', at: { lt: cutoff } },
        data: {
          status: 'interrupted',
          ok: false,
          finishedAt: new Date(),
          output: 'Interrupted — the server restarted before this finished. Its outcome was never observed; check the box.',
        },
      })
      .catch(() => ({ count: 0 }));
    return count;
  },

  /** Recent runs, newest first. */
  async log(limit = 25): Promise<{ id: string; actionId: string; status: string; ok: boolean; output: string; durationMs: number; at: Date }[]> {
    return db.hostActionLog.findMany({
      orderBy: { at: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: { id: true, actionId: true, status: true, ok: true, output: true, durationMs: true, at: true },
    });
  },
};
