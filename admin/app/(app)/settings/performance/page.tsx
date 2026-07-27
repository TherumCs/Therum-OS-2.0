import { apiGet } from '../../../../lib/api';
import { Field, NumberInput, SelectField, Toggle } from '../SettingsControls';

export const dynamic = 'force-dynamic';

interface Performance {
  cache: boolean;
  lazyImages: boolean;
  deferJs: boolean;
  disableEmoji: boolean;
  disableEmbeds: boolean;
  heartbeat: 'off' | 'slow' | 'default';
  revisionsLimit: number;
  trashDays: number;
  autosaveInterval: number;
  minCss: boolean;
  minHtml: boolean;
}
const DEFAULTS: Performance = {
  cache: true,
  lazyImages: true,
  deferJs: false,
  disableEmoji: true,
  disableEmbeds: true,
  heartbeat: 'slow',
  revisionsLimit: 5,
  trashDays: 7,
  autosaveInterval: 120,
  minCss: false,
  minHtml: false,
};

interface Runtime {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  nodeVersion: string;
}

function ToggleRow({ label, desc, domain, field, initial }: { label: string; desc: string; domain: string; field: string; initial: boolean }) {
  return (
    <div className="settings-toggle-row">
      <div className="settings-toggle-row-text">
        <span className="settings-toggle-row-label">{label}</span>
        <span className="settings-toggle-row-desc">{desc}</span>
      </div>
      <Toggle domain={domain} field={field} initial={initial} />
    </div>
  );
}

// Every toggle/number on this page saves for real (round-trips through
// Settings) but none of them is load-bearing yet — each group below says
// exactly why. Kept saveable rather than removed so the values are already
// in place the day the underlying feature exists. No cache-busting
// (asset-versioning) mechanism exists anywhere in the codebase either.
export default async function PerformanceSettingsPage() {
  const perf = await apiGet<Performance>('/api/settings/performance').catch(() => DEFAULTS);
  const runtime = await apiGet<Runtime>('/api/system/runtime').catch(
    (): Runtime => ({ rssMb: 0, heapUsedMb: 0, heapTotalMb: 0, nodeVersion: process.version }),
  );

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>Performance</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        All settings below save, but none are load-bearing yet — see each group for why.
      </p>

      <div className="settings-group">
        <h3 className="settings-group-title">Node runtime</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, maxWidth: 560 }}>
          <div>
            <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase', display: 'block' }}>
              Node version
            </span>
            <strong>{runtime.nodeVersion}</strong>
          </div>
          <div>
            <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase', display: 'block' }}>
              Heap in use
            </span>
            <strong>{runtime.heapUsedMb} MB</strong>
          </div>
          <div>
            <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase', display: 'block' }}>
              RSS
            </span>
            <strong>{runtime.rssMb} MB</strong>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Caching &amp; loading</h3>
        <p className="settings-group-desc">
          Saved, not load-bearing: Object cache has no in-memory cache layer to gate yet; lazy-load and defer-JS both describe
          public-page rendering, and 2.0 has no public-facing theme/renderer yet.
        </p>
        <ToggleRow label="Object cache" desc="In-memory cache for queries." domain="performance" field="cache" initial={perf.cache} />
        <ToggleRow
          label="Lazy-load images"
          desc="Defer below-fold images until they're scrolled into view."
          domain="performance"
          field="lazyImages"
          initial={perf.lazyImages}
        />
        <ToggleRow
          label="Defer non-critical JS"
          desc="Add `defer` to non-essential scripts. Speeds up first paint."
          domain="performance"
          field="deferJs"
          initial={perf.deferJs}
        />
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Strip the bloat</h3>
        <p className="settings-group-desc">
          Saved, not load-bearing: emoji/oEmbed scripts are a public-page concern and 2.0 has no public renderer yet;
          heartbeat frequency has no polling mechanism in this admin to slow down or turn off.
        </p>
        <ToggleRow
          label="Disable emoji scripts"
          desc="Skip loading the emoji-rendering polyfill."
          domain="performance"
          field="disableEmoji"
          initial={perf.disableEmoji}
        />
        <ToggleRow
          label="Disable oEmbed scripts"
          desc="Skip loading the embed-detection script."
          domain="performance"
          field="disableEmbeds"
          initial={perf.disableEmbeds}
        />
        <Field label="Heartbeat frequency">
          <SelectField
            domain="performance"
            field="heartbeat"
            initial={perf.heartbeat}
            options={[
              ['off', 'Off (no autosave / no realtime)'],
              ['slow', 'Slow (60s) — recommended'],
              ['default', 'Default (15s)'],
            ]}
          />
        </Field>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Data housekeeping</h3>
        <p className="settings-group-desc">
          Saved, not load-bearing: Content has no revision, trash, or autosave concept in this schema, so there&apos;s
          nothing yet for these numbers to bound.
        </p>
        <Field label="Post revisions kept">
          <NumberInput domain="performance" field="revisionsLimit" initial={perf.revisionsLimit} />
        </Field>
        <Field label="Auto-empty trash after (days)">
          <NumberInput domain="performance" field="trashDays" initial={perf.trashDays} />
        </Field>
        <Field label="Autosave interval (seconds)">
          <NumberInput domain="performance" field="autosaveInterval" initial={perf.autosaveInterval} />
        </Field>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Minification</h3>
        <p className="settings-group-desc">
          Saved, not load-bearing: both describe minifying public-page output, and 2.0 has no public-facing renderer yet
          to apply it to.
        </p>
        <ToggleRow label="Minify CSS" desc="" domain="performance" field="minCss" initial={perf.minCss} />
        <ToggleRow label="Minify HTML" desc="" domain="performance" field="minHtml" initial={perf.minHtml} />
      </div>
    </div>
  );
}
