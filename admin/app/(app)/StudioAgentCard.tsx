'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BASE_PATH } from '../../lib/session';

// The assistant, as a dashboard card.
//
// Runs are server-side jobs with ids and this polls them. That is the whole
// reason it survives being collapsed, resized, or navigated away from — the
// work is not attached to the request that started it, or to this component
// being mounted.

interface RunStep {
  kind: 'text' | 'tool';
  name?: string;
  input?: string;
  text: string;
  at: number;
  ok?: boolean;
}

interface Run {
  id: string;
  prompt: string;
  status: 'running' | 'done' | 'error' | 'stopped';
  steps: RunStep[];
  answer: string;
  error?: string;
  stepsUsed: number;
  proposals: string[];
}

interface Proposal {
  id: string;
  label: string;
  diff: string;
  stats: { added: number; removed: number };
  warnings: string[];
  appliedAt?: number;
}

const POLL_MS = 900;

export function StudioAgentCard() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const timer = useRef<number | null>(null);

  useEffect(() => {
    void fetch(`${BASE_PATH}/api/agent/status`)
      .then((r) => r.json())
      .then((d: { ready: boolean; reason?: string }) => {
        setReady(d.ready);
        setReason(d.reason ?? '');
      })
      .catch(() => setReady(false));
  }, []);

  const stopPolling = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const loadProposal = useCallback(async (id: string) => {
    const res = await fetch(`${BASE_PATH}/api/agent/proposals/${id}`);
    if (!res.ok) return;
    const p = (await res.json()) as Proposal;
    setProposals((prev) => ({ ...prev, [p.id]: p }));
  }, []);

  const poll = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`${BASE_PATH}/api/agent/runs/${id}`);
        if (!res.ok) throw new Error(`Run lookup failed (${res.status})`);
        const next = (await res.json()) as Run;
        setRun(next);
        for (const pid of next.proposals) void loadProposal(pid);
        if (next.status === 'running') {
          timer.current = window.setTimeout(() => void poll(id), POLL_MS);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [loadProposal],
  );

  useEffect(() => stopPolling, [stopPolling]);

  async function ask(): Promise<void> {
    if (!prompt.trim()) return;
    setBusy(true);
    setError(null);
    setProposals({});
    stopPolling();
    try {
      const res = await fetch(`${BASE_PATH}/api/agent/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error((await res.text()) || `Failed (${res.status})`);
      const started = (await res.json()) as Run;
      setRun(started);
      setExpanded(true);
      void poll(started.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyProposal(id: string): Promise<void> {
    setError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/agent/proposals/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ proposalId: id }),
      });
      if (!res.ok) throw new Error((await res.text()) || `Apply failed (${res.status})`);
      await loadProposal(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (ready === false) {
    return <p className="muted th-agent__idle">{reason || 'Assistant unavailable.'}</p>;
  }

  const running = run?.status === 'running';

  return (
    <div className={'th-agent' + (expanded ? ' is-expanded' : '')}>
      <div className="th-agent__ask">
        <input
          className="th-agent__input"
          placeholder="Ask about this site, the host, or a CSS tweak…"
          value={prompt}
          disabled={busy || running || ready === null}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask();
            }
          }}
        />
        <button type="button" className="th-btn-primary" onClick={() => void ask()} disabled={busy || running || !prompt.trim()}>
          {running ? 'Working…' : 'Ask'}
        </button>
      </div>

      {error && <p className="th-agent__error">{error}</p>}

      {run && (
        <div className="th-agent__run">
          <div className="th-agent__meta">
            <span className={`th-agent__status th-agent__status--${run.status}`}>{run.status}</span>
            <span className="muted">step {run.stepsUsed}</span>
            {run.steps.length > 0 && (
              <button type="button" className="th-agent__toggle" onClick={() => setExpanded((v) => !v)}>
                {expanded ? 'Hide work' : 'Show work'}
              </button>
            )}
          </div>

          {/* The transcript. Tool calls are shown rather than hidden: the
              point of an assistant with tools is that you can see what it
              actually looked at. */}
          {expanded && (
            <ol className="th-agent__steps">
              {run.steps.map((s, i) => (
                <li key={i} className={'th-agent__step th-agent__step--' + s.kind + (s.ok === false ? ' is-bad' : '')}>
                  {s.kind === 'tool' ? (
                    <>
                      <code className="th-agent__tool">{s.name}</code>
                      {s.input && <code className="th-agent__args">{s.input}</code>}
                      <pre className="th-agent__result">{s.text}</pre>
                    </>
                  ) : (
                    <p>{s.text}</p>
                  )}
                </li>
              ))}
            </ol>
          )}

          {run.answer && <div className="th-agent__answer">{run.answer}</div>}
          {run.error && <p className="th-agent__error">{run.error}</p>}

          {/* Proposals are the only way a run changes anything, and applying
              is always this explicit click. */}
          {Object.values(proposals).map((p) => (
            <div key={p.id} className="th-agent__proposal">
              <div className="th-agent__meta">
                <strong>{p.label}</strong>
                <span className="muted">
                  +{p.stats.added} −{p.stats.removed}
                </span>
                {p.appliedAt ? (
                  <span className="th-agent__status th-agent__status--done">applied</span>
                ) : (
                  <button type="button" className="th-btn-primary" onClick={() => void applyProposal(p.id)}>
                    Apply
                  </button>
                )}
              </div>
              <pre className="th-agent__diff">{p.diff}</pre>
              {p.warnings.map((w, i) => (
                <p key={i} className="th-agent__warn">
                  {w}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
