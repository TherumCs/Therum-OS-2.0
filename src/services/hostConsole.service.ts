import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { db } from '../lib/db.js';

const execFileAsync = promisify(execFile);

// A console, deliberately not a shell.
//
// You type a line, this PARSES it against the grammar below, and runs the
// matching implementation with arguments it validated itself. What it will not
// do is hand your line to a shell — so there is no quoting to get right, no
// metacharacter to escape, and no `;` that turns one command into two.
//
// Every command here READS. Nothing in this file starts, stops, writes or
// installs; that lives in hostAction.service.ts where each capability is a
// reviewed entry with a stated rollback. The split is the point: looking at a
// server is the thing you do forty times a day and should be frictionless, and
// changing one is the thing that should cost a confirmation.
//
// The honest trade: this is not a terminal and will refuse things a terminal
// would do. That refusal names what IS allowed, so it stays usable rather than
// becoming a guessing game.

/** Units this console will talk about. Not free text — a unit name reaching
 *  systemctl unfiltered is how "status" becomes "status; anything". */
const UNITS = ['nginx', 'postgresql', 'redis-server', 'redis', 'ssh', 'pm2-therum'] as const;

/** Logs it will tail. An arbitrary path here would read /etc/shadow. */
const LOGS: Record<string, string> = {
  'nginx-access': '/var/log/nginx/access.log',
  'nginx-error': '/var/log/nginx/error.log',
  syslog: '/var/log/syslog',
  auth: '/var/log/auth.log',
};

export interface ConsoleCommand {
  /** First token typed. */
  name: string;
  usage: string;
  help: string;
  /** Linux-only commands are hidden and refused on a laptop. */
  deployedOnly: boolean;
  /** Validate the remaining tokens and return the argv to run, or throw. */
  build(args: string[]): { bin: string; argv: string[]; sudo?: boolean };
}

const CONSOLE_TIMEOUT_MS = 20_000;

function intArg(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`Expected a whole number from 1 to ${max}, got "${raw}".`);
  return n;
}

function unitArg(raw: string | undefined): string {
  if (!raw) throw new Error(`Which service? One of: ${UNITS.join(', ')}.`);
  if (!(UNITS as readonly string[]).includes(raw)) {
    throw new Error(`"${raw}" is not a service this console knows. One of: ${UNITS.join(', ')}.`);
  }
  return raw;
}

export const CONSOLE_COMMANDS: ConsoleCommand[] = [
  { name: 'df', usage: 'df', help: 'Disk use per filesystem.', deployedOnly: false, build: () => ({ bin: 'df', argv: ['-h'] }) },
  { name: 'free', usage: 'free', help: 'Memory and swap.', deployedOnly: true, build: () => ({ bin: 'free', argv: ['-m'] }) },
  { name: 'uptime', usage: 'uptime', help: 'Load average and how long the box has been up.', deployedOnly: false, build: () => ({ bin: 'uptime', argv: [] }) },
  { name: 'who', usage: 'who', help: 'Who is logged in right now.', deployedOnly: true, build: () => ({ bin: 'who', argv: [] }) },
  {
    name: 'status',
    usage: 'status <service>',
    help: `Is it running? Services: ${UNITS.join(', ')}.`,
    deployedOnly: true,
    build: (args) => ({ bin: 'systemctl', argv: ['status', '--no-pager', '--lines=20', unitArg(args[0])] }),
  },
  {
    name: 'journal',
    usage: 'journal <service> [lines]',
    help: 'Recent journald lines for one service. Default 100, max 500.',
    deployedOnly: true,
    build: (args) => ({ bin: 'journalctl', argv: ['-u', unitArg(args[0]), '-n', String(intArg(args[1], 100, 500)), '--no-pager'], sudo: true }),
  },
  {
    name: 'log',
    usage: `log <${Object.keys(LOGS).join('|')}> [lines]`,
    help: 'Tail one of the known log files. Default 100, max 500.',
    deployedOnly: true,
    build: (args) => {
      const path = LOGS[args[0] ?? ''];
      if (!path) throw new Error(`Unknown log. One of: ${Object.keys(LOGS).join(', ')}.`);
      return { bin: 'tail', argv: ['-n', String(intArg(args[1], 100, 500)), path], sudo: true };
    },
  },
  { name: 'ports', usage: 'ports', help: 'What is listening, and on which interface.', deployedOnly: true, build: () => ({ bin: 'ss', argv: ['-tulpn'], sudo: true }) },
  { name: 'firewall', usage: 'firewall', help: 'ufw rules, verbose.', deployedOnly: true, build: () => ({ bin: 'ufw', argv: ['status', 'verbose'], sudo: true }) },
  { name: 'processes', usage: 'processes', help: 'PM2 process table as JSON.', deployedOnly: true, build: () => ({ bin: 'pm2', argv: ['jlist'] }) },
  {
    name: 'certs',
    usage: 'certs',
    help: 'Certificates certbot manages, and when they expire.',
    deployedOnly: true,
    build: () => ({ bin: 'certbot', argv: ['certificates'], sudo: true }),
  },
  {
    name: 'deployed',
    usage: 'deployed [count]',
    help: 'The last commits on this box — what is actually running. Default 10, max 50.',
    deployedOnly: false,
    build: (args) => ({ bin: 'git', argv: ['log', '--oneline', `-n${intArg(args[0], 10, 50)}`] }),
  },
];

export function consoleCommandByName(name: string): ConsoleCommand | undefined {
  return CONSOLE_COMMANDS.find((c) => c.name === name);
}

/** Characters that only mean something to a shell. We never invoke one, so
 *  they can only be an attempt — refused by name rather than stripped, because
 *  silently rewriting someone's input is how a filter becomes a bypass. */
const SHELL_CHARS = /[;&|`$><(){}\\\n\r]/;

export interface ConsoleResult {
  command: string;
  ok: boolean;
  output: string;
  durationMs: number;
}

export const hostConsoleService = {
  /** What this host will accept, for the hint line under the input. */
  commands(): { name: string; usage: string; help: string; available: boolean }[] {
    const deployed = os.platform() === 'linux';
    return CONSOLE_COMMANDS.map((c) => ({
      name: c.name,
      usage: c.usage,
      help: c.help,
      available: !c.deployedOnly || deployed,
    }));
  },

  async run(line: string, actorId?: string | null): Promise<ConsoleResult> {
    const raw = (line ?? '').trim();
    if (raw.length === 0) throw new Error('Nothing to run.');
    if (raw.length > 200) throw new Error('Too long to be one of these commands.');
    if (SHELL_CHARS.test(raw)) {
      throw new Error('Shell syntax is not accepted — this console runs one known command at a time, not a shell line.');
    }

    const [name = '', ...args] = raw.split(/\s+/);
    const command = consoleCommandByName(name);
    if (!command) {
      throw new Error(`"${name}" is not a command here. Try: ${CONSOLE_COMMANDS.map((c) => c.name).join(', ')}.`);
    }
    // Arguments are validated BEFORE the platform gate, and both before
    // anything is spawned. Order matters twice: a typo gets the useful message
    // rather than "not on this host", and the validation is provable on a
    // laptop instead of only on the box it protects.
    const { bin, argv, sudo } = command.build(args);

    if (command.deployedOnly && os.platform() !== 'linux') {
      throw new Error(`"${name}" needs a Linux server — this host is ${os.platform()}.`);
    }

    const started = Date.now();
    let ok = true;
    let output: string;
    try {
      const { stdout, stderr } = await execFileAsync(sudo ? 'sudo' : bin, sudo ? ['-n', bin, ...argv] : argv, {
        timeout: CONSOLE_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      });
      output = [stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)';
    } catch (e) {
      ok = false;
      // A non-zero exit is still information — `systemctl status` on a stopped
      // unit exits 3 and its output is exactly what you asked to see.
      const err = e as { stdout?: string; stderr?: string; message?: string };
      output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim() || err.message || String(e);
    }
    const durationMs = Date.now() - started;
    if (output.length > 20_000) output = `${output.slice(0, 20_000)}\n… (truncated)`;

    await db.hostActionLog
      .create({ data: { actionId: `console:${name}`, actorId: actorId ?? null, ok, output, durationMs } })
      .catch(() => undefined);

    return { command: `${bin} ${argv.join(' ')}`, ok, output, durationMs };
  },
};
