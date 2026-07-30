'use client';
import { useState, type ReactNode, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../lib/session';
import { Field, Toggle, SelectField, TextInput, NumberInput } from './settings/SettingsControls';
import type { Appearance, Behavior } from '../../lib/appearance';

// The feature-inventory's "one always-available live panel" (section 05,
// Chrome & Customization Studio) — a slide-out drawer, not a settings page,
// reachable from the topbar on every screen. Reuses SettingsControls.tsx's
// domain='appearance' primitives for the 33 site-wide fields (they already
// PATCH /api/settings/appearance + router.refresh() — the refresh is load-
// bearing here, not just a nicety: the data-* attributes these fields
// control live on #th-shell in the server-rendered layout, so a soft
// Next.js refresh is what actually applies a change, not local React state).
// Behavior/Advanced are per-user (/api/me/*), a different endpoint shape,
// so those get their own small save() below rather than reusing Toggle/
// SelectField's domain-based one.

async function saveMe(path: string, body: unknown): Promise<void> {
  await fetch(`${BASE_PATH}/api/me/${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="settings-group">
      <div className="settings-group-title" style={{ fontSize: 'var(--th-fs-sm)', marginBottom: 'var(--th-space-10)' }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--th-space-14)' }}>{children}</div>
    </div>
  );
}

function ToggleRow({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="settings-toggle-row">
      <div className="settings-toggle-row-text">
        <div className="settings-toggle-row-label">{label}</div>
        {help && <div className="settings-toggle-row-desc">{help}</div>}
      </div>
      {children}
    </div>
  );
}

function BehaviorToggleRow({ label, field, initial }: { label: string; field: keyof Behavior; initial: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function toggle(): Promise<void> {
    const next = !checked;
    setChecked(next);
    setBusy(true);
    try {
      await saveMe('behavior', { [field]: next });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToggleRow label={label}>
      <label className="th-switch">
        <input type="checkbox" checked={checked} disabled={busy} onChange={() => void toggle()} />
        <span className="th-switch-track" />
      </label>
    </ToggleRow>
  );
}

function BehaviorTextField({ label, field, initial, placeholder }: { label: string; field: keyof Behavior; initial: string; placeholder?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function commit(): Promise<void> {
    if (value === initial) return;
    setBusy(true);
    try {
      await saveMe('behavior', { [field]: value });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Field label={label}>
      <input className="settings-text-input" value={value} placeholder={placeholder} disabled={busy} onChange={(e) => setValue(e.target.value)} onBlur={() => void commit()} />
    </Field>
  );
}

function BehaviorNumberField({ label, field, initial, help }: { label: string; field: keyof Behavior; initial: number | null; help?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial === null ? '' : String(initial));
  const [busy, setBusy] = useState(false);
  async function commit(): Promise<void> {
    const n = value.trim() === '' ? null : Number(value);
    if (n !== null && !Number.isFinite(n)) return;
    setBusy(true);
    try {
      await saveMe('behavior', { [field]: n });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Field label={label} help={help}>
      <input
        type="number"
        className="settings-text-input settings-text-input-narrow"
        value={value}
        placeholder="Use default"
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
      />
    </Field>
  );
}

function CustomCssField({ initial }: { initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  async function commit(): Promise<void> {
    if (value === initial) return;
    setBusy(true);
    try {
      await saveMe('custom-css', { css: value });
      router.refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Field label="Custom CSS" help="Applies to your own admin view only. Sanitized on save (@import, expression(), script-bearing url()s are stripped).">
      <textarea
        className="settings-text-input"
        style={{ fontFamily: 'var(--th-font-mono)', fontSize: 'var(--th-fs-xs)', minHeight: 160, resize: 'vertical', maxWidth: 'none' }}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        spellCheck={false}
      />
      {saved && <p className="field-help">Saved.</p>}
    </Field>
  );
}

function ExportImport() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function doExport(): Promise<void> {
    const res = await fetch(`${BASE_PATH}/api/settings/export`);
    const data: unknown = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'therum-appearance-export.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function doImport(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const res = await fetch(`${BASE_PATH}/api/settings/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) throw new Error(`Import failed (${res.status})`);
      setMsg('Imported.');
      router.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Import failed — not valid JSON.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Field label="Export / import" help="Export everything above as JSON; import re-applies only the fields it recognizes — unrecognized keys in pasted JSON are silently ignored, never applied.">
      <div style={{ display: 'flex', gap: 'var(--th-space-8)', alignItems: 'center' }}>
        <button type="button" className="ghost" onClick={() => void doExport()}>
          Export JSON
        </button>
        <label className="th-btn" style={{ cursor: 'pointer' }}>
          {busy ? 'Importing…' : 'Import JSON'}
          <input type="file" accept="application/json" onChange={(e) => void doImport(e)} disabled={busy} style={{ display: 'none' }} />
        </label>
      </div>
      {msg && <p className="field-help">{msg}</p>}
    </Field>
  );
}

export function QuickControlsPanel({
  appearance,
  behavior,
  triggerClassName = 'th-top-btn',
  iconSize = 16,
}: {
  appearance: Appearance;
  behavior: Behavior;
  triggerClassName?: string;
  iconSize?: number;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'quick' | 'behavior' | 'advanced'>('quick');

  return (
    <>
      <button type="button" className={triggerClassName} title="Quick Controls" onClick={() => setOpen(true)}>
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="18" x2="20" y2="18" />
          <circle cx="9" cy="6" r="2" fill="currentColor" />
          <circle cx="16" cy="12" r="2" fill="currentColor" />
          <circle cx="11" cy="18" r="2" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <div className="th-modal-backdrop" style={{ justifyContent: 'flex-end', padding: 0 }} onClick={() => setOpen(false)}>
          <div
            className="th-modal"
            style={{ maxWidth: 420, height: '100vh', maxHeight: '100vh', borderRadius: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="th-modal-header">
              <h2>Quick Controls</h2>
              <button type="button" className="th-modal-close" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            <div style={{ display: 'flex', gap: 'var(--th-space-4)', padding: '0 var(--th-space-20)', borderBottom: '1px solid var(--th-line)' }}>
              {(['quick', 'behavior', 'advanced'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className="ghost"
                  onClick={() => setTab(t)}
                  style={{
                    border: 'none',
                    borderBottom: tab === t ? '2px solid var(--th-accent)' : '2px solid transparent',
                    borderRadius: 0,
                    background: 'none',
                    padding: 'var(--th-space-10) var(--th-space-4)',
                    color: tab === t ? 'var(--th-ink)' : 'var(--th-muted)',
                    fontWeight: tab === t ? 600 : 500,
                  }}
                >
                  {t === 'quick' ? 'Quick Controls' : t === 'behavior' ? 'Behavior' : 'Advanced'}
                </button>
              ))}
            </div>
            <div className="th-modal-body">
              {tab === 'quick' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--th-space-28)' }}>
                  <Group title="Appearance">
                    <Field label="Density">
                      <SelectField domain="appearance" field="density" initial={appearance.density} options={[['compact', 'Compact'], ['comfortable', 'Comfortable (default)'], ['breathing', 'Breathing room']]} />
                    </Field>
                    <Field label="Sidebar style">
                      <SelectField domain="appearance" field="sidebarStyle" initial={appearance.sidebarStyle} options={[['default', 'Default'], ['pills', 'Pills'], ['minimal', 'Minimal']]} />
                    </Field>
                    <Field label="Card style">
                      <SelectField domain="appearance" field="cardStyle" initial={appearance.cardStyle} options={[['flat', 'Flat'], ['shadow', 'Shadow (default)'], ['glass', 'Glass']]} />
                    </Field>
                    <Field label="Color mode" help="The sun icon in the topbar quick-toggles light/dark — pick 'Match system' here to follow the OS instead.">
                      <SelectField domain="appearance" field="colorMode" initial={appearance.colorMode} options={[['light', 'Light'], ['dark', 'Dark'], ['system', 'Match system']]} />
                    </Field>
                    <Field label="Contrast">
                      <SelectField domain="appearance" field="contrast" initial={appearance.contrast} options={[['normal', 'Normal'], ['high', 'High contrast']]} />
                    </Field>
                    <Field label="Accent color" help="Leave default for the built-in accent.">
                      <TextInput domain="appearance" field="accent" initial={appearance.accent} type="color" />
                    </Field>
                    <Field label="Intensity">
                      <SelectField domain="appearance" field="intensity" initial={appearance.intensity} options={[['subtle', 'Subtle'], ['normal', 'Normal'], ['vivid', 'Vivid']]} />
                    </Field>
                  </Group>

                  <Group title="Layout">
                    <Field label="Topbar behavior">
                      <SelectField domain="appearance" field="topbarBehavior" initial={appearance.topbarBehavior} options={[['default', 'Flush (default)'], ['sticky', 'Floating + sticky']]} />
                    </Field>
                    <Field label="Content width">
                      <SelectField domain="appearance" field="contentWidth" initial={appearance.contentWidth} options={[['full', 'Full (default)'], ['normal', 'Normal'], ['narrow', 'Narrow']]} />
                    </Field>
                    <Field label="Dashboard card grid gap">
                      <SelectField domain="appearance" field="cardGridGap" initial={appearance.cardGridGap} options={[['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']]} />
                    </Field>
                  </Group>

                  <Group title="Surfaces">
                    <Field label="Glass tint" help="Only visible when Card style (below) is Glass.">
                      <TextInput domain="appearance" field="glassTint" initial={appearance.glassTint} type="color" />
                    </Field>
                    <Field label="Blur strength">
                      <SelectField domain="appearance" field="blurStrength" initial={appearance.blurStrength} options={[['light', 'Light'], ['medium', 'Medium'], ['heavy', 'Heavy']]} />
                    </Field>
                    <Field label="Background">
                      <SelectField domain="appearance" field="background" initial={appearance.background} options={[['solid', 'Solid'], ['subtle-gradient', 'Subtle gradient']]} />
                    </Field>
                    <Field label="Shadow style">
                      <SelectField domain="appearance" field="shadowStyle" initial={appearance.shadowStyle} options={[['none', 'None'], ['subtle', 'Subtle (default)'], ['pronounced', 'Pronounced']]} />
                    </Field>
                  </Group>

                  <Group title="Typography">
                    <Field label="Body font" help="Leave blank for the system default.">
                      <TextInput domain="appearance" field="bodyFont" initial={appearance.bodyFont} placeholder="e.g. Georgia" />
                    </Field>
                    <Field label="Display font">
                      <TextInput domain="appearance" field="displayFont" initial={appearance.displayFont} placeholder="e.g. Inter Tight" />
                    </Field>
                    <Field label="Mono font">
                      <TextInput domain="appearance" field="monoFont" initial={appearance.monoFont} placeholder="e.g. JetBrains Mono" />
                    </Field>
                    <Field label="Base size">
                      <SelectField domain="appearance" field="baseSize" initial={appearance.baseSize} options={[['sm', 'Small'], ['md', 'Medium (default)'], ['lg', 'Large']]} />
                    </Field>
                    <Field label="Letter spacing" help="Applies to body text.">
                      <SelectField domain="appearance" field="letterSpacing" initial={appearance.letterSpacing} options={[['tight', 'Tight'], ['normal', 'Normal'], ['wide', 'Wide']]} />
                    </Field>
                    <Field label="Line height" help="Applies to body text.">
                      <SelectField domain="appearance" field="lineHeight" initial={appearance.lineHeight} options={[['compact', 'Compact'], ['normal', 'Normal'], ['relaxed', 'Relaxed']]} />
                    </Field>
                  </Group>

                  <Group title="Shapes">
                    <Field label="Corner radius">
                      <SelectField domain="appearance" field="cornerRadius" initial={appearance.cornerRadius} options={[['sharp', 'Sharp'], ['default', 'Default'], ['round', 'Round']]} />
                    </Field>
                    <Field label="Border weight">
                      <SelectField domain="appearance" field="borderWeight" initial={appearance.borderWeight} options={[['thin', 'Thin'], ['default', 'Default'], ['thick', 'Thick']]} />
                    </Field>
                  </Group>

                  <Group title="Motion">
                    <ToggleRow label="Motion" help="Turns off transitions and animations app-wide.">
                      <Toggle domain="appearance" field="motionEnabled" initial={appearance.motionEnabled} />
                    </ToggleRow>
                    <Field label="Transition speed">
                      <SelectField domain="appearance" field="transitionSpeed" initial={appearance.transitionSpeed} options={[['fast', 'Fast'], ['default', 'Default'], ['slow', 'Slow']]} />
                    </Field>
                    <Field label="Page transition">
                      <SelectField domain="appearance" field="pageTransitions" initial={appearance.pageTransitions} options={[['off', 'Off'], ['fade', 'Fade'], ['slide', 'Slide'], ['scale', 'Scale'], ['morph', 'Morph']]} />
                    </Field>
                    <ToggleRow label="Hover lift" help="The dock's icon-hover lift effect.">
                      <Toggle domain="appearance" field="hoverLift" initial={appearance.hoverLift} />
                    </ToggleRow>
                  </Group>

                  <Group title="Content defaults">
                    <Field label="Card layout">
                      <SelectField domain="appearance" field="cardLayout" initial={appearance.cardLayout} options={[['compact', 'Compact'], ['comfortable', 'Comfortable (default)']]} />
                    </Field>
                    <Field label="Thumbnail source" help="'Cover only' skips extracting a fallback image from the body when SEO needs a share image.">
                      <SelectField domain="appearance" field="thumbnailSource" initial={appearance.thumbnailSource} options={[['auto', 'Auto (default)'], ['cover-only', 'Cover only']]} />
                    </Field>
                    <Field label="Items per page">
                      <NumberInput domain="appearance" field="itemsPerPage" initial={appearance.itemsPerPage} />
                    </Field>
                  </Group>

                  <Group title="Accessibility">
                    <ToggleRow label="Reduce transparency" help="Forces glass surfaces off regardless of Card style.">
                      <Toggle domain="appearance" field="reduceTransparency" initial={appearance.reduceTransparency} />
                    </ToggleRow>
                    <ToggleRow label="Underline links">
                      <Toggle domain="appearance" field="underlineLinks" initial={appearance.underlineLinks} />
                    </ToggleRow>
                    <ToggleRow label="Always-visible focus rings" help="Shows the focus ring on click, not just keyboard navigation.">
                      <Toggle domain="appearance" field="alwaysVisibleFocusRings" initial={appearance.alwaysVisibleFocusRings} />
                    </ToggleRow>
                    <ToggleRow label="Larger click targets">
                      <Toggle domain="appearance" field="largerClickTargets" initial={appearance.largerClickTargets} />
                    </ToggleRow>
                  </Group>

                  <Group title="Advanced">
                    <ToggleRow label="Keyboard shortcuts" help="⌘K and similar.">
                      <Toggle domain="appearance" field="keyboardShortcuts" initial={appearance.keyboardShortcuts} />
                    </ToggleRow>
                    <ToggleRow label="Debug overlays" help="Outlines the sidebar, topbar, and content regions.">
                      <Toggle domain="appearance" field="debugOverlays" initial={appearance.debugOverlays} />
                    </ToggleRow>
                  </Group>
                </div>
              )}

              {tab === 'behavior' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--th-space-14)' }}>
                  <BehaviorTextField label="Login landing page" field="loginLandingPage" initial={behavior.loginLandingPage ?? ''} placeholder="/ (dashboard)" />
                  <BehaviorToggleRow label="Sidebar starts folded" field="sidebarFolded" initial={behavior.sidebarFolded} />
                  <BehaviorNumberField label="List page row count" field="listPageRowCount" initial={behavior.listPageRowCount} help="Overrides the site-wide Items per page default for you only." />
                </div>
              )}

              {tab === 'advanced' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--th-space-20)' }}>
                  <CustomCssField initial={behavior.customCss} />
                  <ExportImport />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
