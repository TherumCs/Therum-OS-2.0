'use client';
import { useCallback, useEffect, useState } from 'react';
import { BASE_PATH } from '../../../../lib/session';

// The Server panel — what a cPanel would have been, minus everything this box
// does not need (mailboxes, DNS zones, per-site PHP) and minus the part that
// makes those panels dangerous: there is no command box on this screen. Every
// button maps to one entry in a list compiled into the server.
//
// Nothing runs without showing the exact command first. That is the whole
// interaction: press, read what it will do, confirm.

type Risk = 'read' | 'restart' | 'sensitive';
type Group = 'service' | 'security' | 'tuning' | 'logs';

interface Action {
  id: string;
  group: Group;
  label: string;
  description: string;
  command: string;
  risk: Risk;
  scope: 'any' | 'deployed';
  fixes: string[];
  revert: string;
  available: boolean;
}

interface LogRow {
  id: string;
  actionId: string;
  ok: boolean;
  output: string;
  durationMs: number;
  at: string;
}

interface ConsoleCommand {
  name: string;
  usage: string;
  help: string;
  available: boolean;
}

interface ConsoleLine {
  input: string;
  ok: boolean;
  output: string;
}

interface RunResult {
  id: string;
  ok: boolean;
  dryRun: boolean;
  command: string;
  output: string;
  durationMs: number;
}

const GROUP_LABEL: Record<Group, string> = {
  service: 'Services',
  security: 'Security',
  tuning: 'Tuning',
  logs: 'Logs',
};

const GROUP_DESC: Record<Group, string> = {
  service: 'Restart what is running, and check nginx before it reloads.',
  security: 'The firewall, SSH, patches and certificates — the findings the advisor raises most.',
  tuning: 'Memory limits that only matter once the box has real RAM to divide.',
  logs: 'Read-only. Where a 502 explains itself.',
};

const RISK_LABEL: Record<Risk, string> = {
  read: 'Reads only',
  restart: 'Brief interruption',
  sensitive: 'Changes access',
};

export function ServerClient() {
  const [actions, setActions] = useState<Action[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [pending, setPending] = useState<Action | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commands, setCommands] = useState<ConsoleCommand[]>([]);
  const [line, setLine] = useState('');
  const [history, setHistory] = useState<ConsoleLine[]>([]);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_PATH}/api/host/actions`);
      if (!res.ok) throw new Error(`Could not load actions (${res.status})`);
      const data = (await res.json()) as { actions: Action[]; log: LogRow[] };
      setActions(data.actions ?? []);
      setLog(data.log ?? []);
      const cmds = await fetch(`${BASE_PATH}/api/host/console`).then((r) => (r.ok ? r.json() : { commands: [] }));
      setCommands((cmds as { commands: ConsoleCommand[] }).commands ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: Action): Promise<void> {
    setBusy(action.id);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/host/actions/${encodeURIComponent(action.id)}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dryRun: false }),
      });
      const body = (await res.json()) as RunResult & { error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `Refused (${res.status})`);
      setResult(body);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setPending(null);
    }
  }

  async function send(): Promise<void> {
    const input = line.trim();
    if (!input || running) return;
    setRunning(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/host/console/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ line: input }),
      });
      const body = (await res.json()) as { ok?: boolean; output?: string; error?: { message?: string } };
      // A refusal is printed into the console like any other result — it says
      // what IS allowed, which is the useful half of being told no.
      setHistory((h) => [...h, { input, ok: res.ok && body.ok !== false, output: body.output ?? body.error?.message ?? '' }]);
      setLine('');
    } catch (e) {
      setHistory((h) => [...h, { input, ok: false, output: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setRunning(false);
    }
  }

  const groups: Group[] = ['service', 'security', 'tuning', 'logs'];
  const unavailable = actions.filter((a) => !a.available).length;

  return (
    <div className="th-srv">
      {error && <p className="th-adv__error">{error}</p>}

      {unavailable > 0 && (
        <p className="th-srv__note">
          {unavailable} actions need a Linux server and are disabled here. They appear the moment this install runs on
          the VPS — nothing to switch on.
        </p>
      )}

      {groups.map((g) => {
        const inGroup = actions.filter((a) => a.group === g);
        if (inGroup.length === 0) return null;
        return (
          <section key={g} className="th-srv__group">
            <h2 className="th-srv__grouptitle">{GROUP_LABEL[g]}</h2>
            <p className="th-srv__groupdesc">{GROUP_DESC[g]}</p>
            <ul className="th-srv__list">
              {inGroup.map((a) => (
                <li key={a.id} className="th-srv__item" data-available={a.available}>
                  <div className="th-srv__meta">
                    <span className="th-srv__label">{a.label}</span>
                    <span className={`th-srv__risk th-srv__risk--${a.risk}`}>{RISK_LABEL[a.risk]}</span>
                  </div>
                  <p className="th-srv__desc">{a.description}</p>
                  <code className="th-srv__cmd">{a.command}</code>
                  <button
                    type="button"
                    className={`th-btn${a.risk === 'sensitive' ? ' th-btn-danger' : ''}`}
                    disabled={!a.available || busy !== null}
                    onClick={() => setPending(a)}
                  >
                    {busy === a.id ? 'Running…' : a.risk === 'read' ? 'Show' : 'Run'}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {/* Confirmation names the command and how to undo it. A panel that runs
          privileged work on one click is how an accidental firewall enable
          ends a session. */}
      {pending && (
        <div className="th-srv__confirm" role="dialog" aria-modal="true" aria-label={`Confirm ${pending.label}`}>
          <div className="th-srv__confirmbox">
            <h3>{pending.label}</h3>
            <p>{pending.description}</p>
            <div className="th-srv__confirmlabel">Will run</div>
            <pre className="th-adv__fix">{pending.command}</pre>
            <div className="th-srv__confirmlabel">To undo</div>
            <p className="th-srv__revert">{pending.revert}</p>
            <div className="th-srv__confirmbtns">
              <button type="button" className="th-btn" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button type="button" className="th-btn th-btn-primary" onClick={() => void run(pending)}>
                Run it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Read-only console. Not a shell — the line is parsed against a fixed
          grammar server-side, so there is nothing here to escape. */}
      <section className="th-srv__group">
        <h2 className="th-srv__grouptitle">Console</h2>
        <p className="th-srv__groupdesc">
          Reads only — status, logs, disk, ports. It parses what you type against a known list rather than running a
          shell, so it will refuse things a terminal would do, and it will tell you what it does accept.
        </p>

        <div className="th-srv__console">
          {history.length === 0 ? (
            <p className="th-srv__consoleidle">Try <code>status nginx</code>, <code>log nginx-error 50</code>, <code>df</code>.</p>
          ) : (
            history.map((h, i) => (
              <div key={i} className="th-srv__consoleline" data-ok={h.ok}>
                <div className="th-srv__consoleinput">$ {h.input}</div>
                <pre className="th-srv__consoleout">{h.output}</pre>
              </div>
            ))
          )}
        </div>

        <div className="th-srv__consolebar">
          <input
            value={line}
            onChange={(e) => setLine(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send();
            }}
            placeholder="status nginx"
            aria-label="Console command"
            spellCheck={false}
            autoComplete="off"
          />
          <button type="button" className="th-btn" onClick={() => void send()} disabled={running || line.trim() === ''}>
            {running ? 'Running…' : 'Run'}
          </button>
        </div>

        <details className="th-adv__skip">
          <summary>{commands.length} commands</summary>
          <ul>
            {commands.map((c) => (
              <li key={c.name} style={{ opacity: c.available ? 1 : 0.55 }}>
                <code>{c.usage}</code> — {c.help}
                {!c.available && ' (server only)'}
              </li>
            ))}
          </ul>
        </details>
      </section>

      {result && (
        <section className="th-srv__result" data-ok={result.ok}>
          <h2 className="th-srv__grouptitle">
            {result.ok ? 'Done' : 'Failed'} — {result.id} <span className="th-srv__ms">{result.durationMs} ms</span>
          </h2>
          <pre className="th-srv__output">{result.output}</pre>
        </section>
      )}

      {log.length > 0 && (
        <section className="th-srv__group">
          <h2 className="th-srv__grouptitle">Recent runs</h2>
          <p className="th-srv__groupdesc">Every action, successful or not, with who ran it and what it printed.</p>
          <ul className="th-srv__log">
            {log.map((row) => (
              <li key={row.id} data-ok={row.ok}>
                <span className="th-srv__logwhen">{new Date(row.at).toLocaleString()}</span>
                <code>{row.actionId}</code>
                <span className={row.ok ? 'th-srv__ok' : 'th-srv__bad'}>{row.ok ? 'ok' : 'failed'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
