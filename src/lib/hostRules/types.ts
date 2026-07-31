import type { Axis, HostScope, ProbeResult } from '../../services/hostProbe.service.js';

// A rule is a deterministic check with a fixed threshold. It decides WHETHER
// something is wrong; a model may later order and explain findings, but it
// never produces one. That split is the whole point: two scans of an
// unchanged host must agree, and advice must be traceable to a measurement.

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface Finding {
  id: string;
  axis: Axis;
  severity: Severity;
  title: string;
  /** What was actually measured. Always cite the number, never just assert. */
  detail: string;
  why: string;
  /** A command or config change a human applies. Never auto-applied. */
  fix: string;
}

export interface Rule {
  id: string;
  axis: Axis;
  scope: HostScope;
  /** Probe ids this rule needs. If any is missing or errored, the rule is
   *  skipped as "not evaluated" rather than reported as passing. */
  probes: string[];
  evaluate(data: Record<string, Record<string, unknown>>): Finding | null;
}

/** Probe payloads keyed by id, for the probes that succeeded. */
export function indexProbes(results: ProbeResult[]): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const r of results) if (r.ok && r.data) out[r.id] = r.data;
  return out;
}

export const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);
export const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
export const bool = (v: unknown): boolean => v === true;

/** Postgres reports sizes in blocks/kB depending on the setting's unit. */
export function pgBytes(setting: string, unit: string | null): number {
  const n = Number(setting);
  if (!Number.isFinite(n)) return 0;
  switch (unit) {
    case '8kB':
      return n * 8 * 1024;
    case 'kB':
      return n * 1024;
    case 'MB':
      return n * 1024 * 1024;
    default:
      return n;
  }
}

export const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
export const mb = (bytes: number): string => `${Math.round(bytes / 1024 / 1024)} MB`;
