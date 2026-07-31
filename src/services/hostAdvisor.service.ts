import { PROBES, runProbes, type Axis, type ProbeResult } from './hostProbe.service.js';
import { securityRules } from '../lib/hostRules/security.js';
import { compressionRules } from '../lib/hostRules/compression.js';
import { performanceRules } from '../lib/hostRules/performance.js';
import { indexProbes, type Finding, type Rule, type Severity } from '../lib/hostRules/types.js';

export const ALL_RULES: Rule[] = [...securityRules, ...compressionRules, ...performanceRules];

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export interface SkippedRule {
  id: string;
  axis: Axis;
  reason: 'not-applicable-local' | 'probe-unavailable';
  detail: string;
}

export interface ScanResult {
  scannedAt: string;
  host: { platform: string; deployed: boolean; hostname: string };
  findings: Finding[];
  /** Rules that could not be judged. Reported explicitly, because a rule that
   *  silently did not run is indistinguishable from a rule that passed — and
   *  "no findings" would then be a lie. */
  skipped: SkippedRule[];
  counts: Record<Severity, number> & { passed: number };
  probes: { id: string; ok: boolean; error?: string }[];
}

/**
 * Run every probe, evaluate every rule, return findings worst-first.
 *
 * A rule produces a finding or nothing. The model never reaches this code —
 * it may narrate or prioritise the output, but whether something is wrong is
 * decided here, by a threshold that can be read and argued with.
 */
export const hostAdvisorService = {
  probes(): { id: string; axis: Axis; label: string; scope: string }[] {
    return PROBES.map((p) => ({ id: p.id, axis: p.axis, label: p.label, scope: p.scope }));
  },

  async scan(): Promise<ScanResult> {
    const results: ProbeResult[] = await runProbes();
    const data = indexProbes(results);

    // The host tells us which half of the rule set is even meaningful. A dev
    // laptop has no firewall to misconfigure and no certificate to expire.
    const osData = data['os'] ?? {};
    const deployed = osData['deployed'] === true;

    const findings: Finding[] = [];
    const skipped: SkippedRule[] = [];
    let passed = 0;

    for (const rule of ALL_RULES) {
      if (rule.scope === 'deployed' && !deployed) {
        skipped.push({
          id: rule.id,
          axis: rule.axis,
          reason: 'not-applicable-local',
          detail: 'Only meaningful on a deployed server.',
        });
        continue;
      }
      const missing = rule.probes.filter((p) => !data[p]);
      if (missing.length > 0) {
        skipped.push({
          id: rule.id,
          axis: rule.axis,
          reason: 'probe-unavailable',
          detail: `Needs ${missing.join(', ')}.`,
        });
        continue;
      }
      let finding: Finding | null = null;
      try {
        finding = rule.evaluate(data);
      } catch (e) {
        // A rule that throws is a bug in the rule, not a finding about the
        // host. Surfacing it as "unavailable" keeps it visible without
        // inventing a problem the host does not have.
        skipped.push({
          id: rule.id,
          axis: rule.axis,
          reason: 'probe-unavailable',
          detail: `Rule error: ${e instanceof Error ? e.message : String(e)}`,
        });
        continue;
      }
      if (finding) findings.push(finding);
      else passed++;
    }

    findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id));

    const counts = { critical: 0, high: 0, medium: 0, low: 0, passed };
    for (const f of findings) counts[f.severity]++;

    return {
      scannedAt: new Date().toISOString(),
      host: {
        platform: typeof osData['platform'] === 'string' ? osData['platform'] : 'unknown',
        deployed,
        hostname: typeof osData['hostname'] === 'string' ? osData['hostname'] : 'unknown',
      },
      findings,
      skipped,
      counts,
      probes: results.map((r) => ({ id: r.id, ok: r.ok, ...(r.error ? { error: r.error } : {}) })),
    };
  },
};
