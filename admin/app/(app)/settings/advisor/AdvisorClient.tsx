'use client';
import { useState } from 'react';
import { BASE_PATH } from '../../../../lib/session';

// Read-only by design. Every finding carries a fix, and every fix is something
// a human runs — nothing on this screen changes the host.

type Severity = 'critical' | 'high' | 'medium' | 'low';

interface Finding {
  id: string;
  axis: string;
  severity: Severity;
  title: string;
  detail: string;
  why: string;
  fix: string;
}

interface Skipped {
  id: string;
  axis: string;
  reason: 'not-applicable-local' | 'probe-unavailable';
  detail: string;
}

interface Scan {
  scannedAt: string;
  host: { platform: string; deployed: boolean; hostname: string };
  findings: Finding[];
  skipped: Skipped[];
  counts: Record<Severity, number> & { passed: number };
  probes: { id: string; ok: boolean; error?: string }[];
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const AXIS_LABEL: Record<string, string> = {
  security: 'Security',
  compression: 'Compression',
  performance: 'Performance',
  inventory: 'Inventory',
};

export function AdvisorClient() {
  const [scan, setScan] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  async function run(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/host/scan`, { method: 'POST' });
      if (!res.ok) throw new Error(`Scan failed (${res.status})`);
      setScan((await res.json()) as Scan);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string): void {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const notApplicable = scan?.skipped.filter((s) => s.reason === 'not-applicable-local') ?? [];
  const unavailable = scan?.skipped.filter((s) => s.reason === 'probe-unavailable') ?? [];

  return (
    <div className="th-adv">
      <div className="th-adv__bar">
        <button type="button" className="th-btn-primary" onClick={() => void run()} disabled={busy}>
          {busy ? 'Scanning…' : scan ? 'Scan again' : 'Run scan'}
        </button>
        {scan && (
          <span className="th-adv__meta">
            {scan.host.hostname} · {scan.host.platform}
            {scan.host.deployed ? ' · deployed' : ' · local'} · {new Date(scan.scannedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && <p className="th-adv__error">{error}</p>}

      {!scan && !busy && (
        <p className="th-adv__idle">
          Reads this machine and reports what it finds across security, compression and performance. Nothing is
          changed — every fix is yours to apply.
        </p>
      )}

      {scan && (
        <>
          <div className="th-adv__counts">
            {(['critical', 'high', 'medium', 'low'] as Severity[]).map((s) => (
              <span key={s} className={`th-adv__count th-adv__count--${s}`} data-zero={scan.counts[s] === 0}>
                <strong>{scan.counts[s]}</strong> {SEVERITY_LABEL[s]}
              </span>
            ))}
            <span className="th-adv__count th-adv__count--pass">
              <strong>{scan.counts.passed}</strong> passed
            </span>
          </div>

          {scan.findings.length === 0 && (
            <p className="th-adv__clean">No findings. {scan.counts.passed} checks passed.</p>
          )}

          <ul className="th-adv__list">
            {scan.findings.map((f) => (
              <li key={f.id} className={`th-adv__item th-adv__item--${f.severity}`}>
                <button type="button" className="th-adv__head" onClick={() => toggle(f.id)} aria-expanded={open.has(f.id)}>
                  <span className={`th-adv__sev th-adv__sev--${f.severity}`}>{SEVERITY_LABEL[f.severity]}</span>
                  <span className="th-adv__title">{f.title}</span>
                  <span className="th-adv__axis">{AXIS_LABEL[f.axis] ?? f.axis}</span>
                </button>
                <p className="th-adv__detail">{f.detail}</p>
                {open.has(f.id) && (
                  <div className="th-adv__body">
                    <p className="th-adv__why">{f.why}</p>
                    <div className="th-adv__fixlabel">Fix</div>
                    <pre className="th-adv__fix">{f.fix}</pre>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {/* A rule that silently did not run is indistinguishable from one
              that passed, so both kinds of skip are shown rather than folded
              into the pass count. */}
          {notApplicable.length > 0 && (
            <details className="th-adv__skip">
              <summary>{notApplicable.length} checks not applicable on a local host</summary>
              <ul>
                {notApplicable.map((s) => (
                  <li key={s.id}>
                    <code>{s.id}</code> — {s.detail}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {unavailable.length > 0 && (
            <details className="th-adv__skip">
              <summary>{unavailable.length} checks could not run</summary>
              <ul>
                {unavailable.map((s) => (
                  <li key={s.id}>
                    <code>{s.id}</code> — {s.detail}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
