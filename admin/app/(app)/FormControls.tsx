'use client';

import { useSettingsForm } from './SettingsForm';

// The batched twins of settings/SettingsControls.tsx. Same look, but they
// write into the SettingsForm buffer instead of PATCHing on every change —
// see SettingsForm.tsx for why a visual settings page should not publish four
// layouts to the live storefront on the way to picking the fifth.

export function FormToggle({ label, desc, field }: { label: string; desc: string; field: string }) {
  const form = useSettingsForm<Record<string, boolean>>();
  const on = Boolean(form.value[field]);
  return (
    <div className="settings-toggle-row">
      <div className="settings-toggle-row-text">
        <span className="settings-toggle-row-label">{label}</span>
        <span className="settings-toggle-row-desc">{desc}</span>
      </div>
      {/* Same markup as settings/SettingsControls.tsx's Toggle, so the two
          look identical — only where the value goes differs. */}
      <label className="th-switch">
        <input type="checkbox" checked={on} aria-label={label} onChange={() => form.set(field, !on)} />
        <span className="th-switch-track" />
      </label>
    </div>
  );
}

export function FormSelect({
  label,
  desc,
  field,
  options,
}: {
  label: string;
  desc: string;
  field: string;
  options: [string, string][];
}) {
  const form = useSettingsForm<Record<string, string>>();
  return (
    <div className="settings-toggle-row">
      <div className="settings-toggle-row-text">
        <span className="settings-toggle-row-label">{label}</span>
        <span className="settings-toggle-row-desc">{desc}</span>
      </div>
      <select className="settings-select" value={form.value[field]} onChange={(e) => form.set(field, e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * A set of options the merchant checks on or off, order preserved.
 *
 * Distinct from a pile of separate booleans: "which filters" is ONE decision
 * with several answers, and modelling it as four unrelated toggles is how a
 * settings page ends up with twenty switches nobody can hold in their head.
 */
export function FormCheckList({
  label,
  desc,
  field,
  options,
}: {
  label: string;
  desc: string;
  field: string;
  options: [string, string, string?][];
}) {
  const form = useSettingsForm<Record<string, string[]>>();
  const chosen = form.value[field] ?? [];

  function toggle(value: string): void {
    // Rebuilt from the option order rather than by pushing onto the end, so
    // the storefront renders them in a stable, declared order no matter what
    // sequence they were clicked in.
    const next = options.map(([v]) => v).filter((v) => (v === value ? !chosen.includes(v) : chosen.includes(v)));
    form.set(field, next);
  }

  return (
    <div className="th-picker">
      <div className="th-picker__head">
        <span className="th-picker__label">{label}</span>
        <span className="th-picker__desc">{desc}</span>
      </div>
      <div className="th-checks">
        {options.map(([value, title, note]) => (
          <label key={value} className={'th-check' + (chosen.includes(value) ? ' on' : '')}>
            <input type="checkbox" checked={chosen.includes(value)} onChange={() => toggle(value)} />
            <span className="th-check__text">
              <span className="th-check__name">{title}</span>
              {note && <span className="th-check__note">{note}</span>}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * A number with recommended values one tap away, and a free field for anything
 * else. Presets alone would be a cage; a bare number field alone makes every
 * merchant guess what a sensible value is.
 */
export function FormPresetNumber({
  label,
  desc,
  field,
  presets,
  min,
  max,
  suffix,
}: {
  label: string;
  desc: string;
  field: string;
  presets: number[];
  min: number;
  max: number;
  suffix?: string;
}) {
  const form = useSettingsForm<Record<string, number>>();
  const value = Number(form.value[field] ?? presets[0]);

  return (
    <div className="th-picker">
      <div className="th-picker__head">
        <span className="th-picker__label">{label}</span>
        <span className="th-picker__desc">{desc}</span>
      </div>
      <div className="th-presets">
        {presets.map((n) => (
          <button
            key={n}
            type="button"
            className={'th-preset' + (value === n ? ' on' : '')}
            onClick={() => form.set(field, n)}
          >
            {n}
          </button>
        ))}
        <span className="th-presets__custom">
          <input
            type="number"
            min={min}
            max={max}
            value={value}
            aria-label={`${label} (custom)`}
            onChange={(e) => {
              // Clamped here as well as in the schema — a value the API would
              // reject should never be sittable in the form.
              const n = Number(e.target.value);
              form.set(field, Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min);
            }}
          />
          {suffix && <span className="th-presets__suffix">{suffix}</span>}
        </span>
      </div>
    </div>
  );
}

export function FormText({
  label,
  desc,
  field,
  placeholder,
}: {
  label: string;
  desc: string;
  field: string;
  placeholder?: string;
}) {
  const form = useSettingsForm<Record<string, string>>();
  return (
    <div className="settings-toggle-row">
      <div className="settings-toggle-row-text">
        <span className="settings-toggle-row-label">{label}</span>
        <span className="settings-toggle-row-desc">{desc}</span>
      </div>
      <input
        className="settings-select"
        type="text"
        value={form.value[field] ?? ''}
        placeholder={placeholder}
        onChange={(e) => form.set(field, e.target.value)}
      />
    </div>
  );
}

// A colour with a shortlist. Nobody wants to type a hex to get "black", and
// nobody wants to be stuck with the four colours we thought of — so the
// swatches are the fast path and the picker is always there underneath.
export function FormColor({
  label,
  desc,
  field,
  presets,
}: {
  label: string;
  desc: string;
  field: string;
  presets: [string, string][];
}) {
  const form = useSettingsForm<Record<string, string>>();
  const current = (form.value[field] ?? '').toLowerCase();
  return (
    <div className="settings-toggle-row settings-toggle-row--stack">
      <div className="settings-toggle-row-text">
        <span className="settings-toggle-row-label">{label}</span>
        <span className="settings-toggle-row-desc">{desc}</span>
      </div>
      <div className="th-swatches">
        {presets.map(([hex, name]) => (
          <button
            key={hex}
            type="button"
            className={`th-swatch${current === hex.toLowerCase() ? ' is-on' : ''}`}
            style={{ background: hex }}
            onClick={() => form.set(field, hex)}
            title={name}
            aria-label={name}
            aria-pressed={current === hex.toLowerCase()}
          />
        ))}
        <label className="th-swatch th-swatch--custom" title="Any colour">
          <input
            type="color"
            value={form.value[field] || '#0a0a0a'}
            onChange={(e) => form.set(field, e.target.value)}
          />
        </label>
        <input
          className="settings-select th-swatch-hex"
          type="text"
          spellCheck={false}
          value={form.value[field] ?? ''}
          onChange={(e) => form.set(field, e.target.value)}
          aria-label={`${label} hex`}
        />
      </div>
    </div>
  );
}
