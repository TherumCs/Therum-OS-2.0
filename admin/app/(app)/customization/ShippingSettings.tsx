'use client';

import { useSettingsForm } from '../SettingsForm';

// Shipping, the operator side of the storefront picker.
//
// The storefront resolves a destination's STATE to a ZONE, then offers each
// METHOD that has a price for that zone. This panel is where those zones,
// methods, and the price at each intersection are set — plus a free-shipping
// threshold and local pickup.
//
// Money is minor units (cents) everywhere in the app, so every amount shown
// here is dollars and converted on the way in and out. Zones and methods are
// arrays of objects; the settings form diffs by reference, so every edit
// writes a BRAND NEW array — never a mutated one, or the change would not save.

type Zone = { id: string; name: string; states: string[]; isRest?: boolean };
type Method = {
  id: string;
  name: string;
  detail: string;
  prices: Record<string, number>;
  amount?: number;
  freeOver: number | null;
  enabled: boolean;
};
type Pickup = { enabled: boolean; price: number; address: string; note: string };

// The catch-all zone. It always exists and is always last to match, so a
// destination in no named zone still resolves to something. Persisted
// explicitly (not just synthesised by the engine) so resolveZone finds a real
// isRest entry rather than falling through to the first named zone.
const REST: Zone = { id: 'rest', name: 'Rest of US', states: [], isRest: true };

const DEFAULT_METHODS: Method[] = [
  { id: 'standard', name: 'Standard', detail: '5–7 business days', prices: { rest: 0 }, freeOver: null, enabled: true },
  { id: 'express', name: 'Express', detail: '2–3 business days', prices: { rest: 999 }, freeOver: null, enabled: true },
  { id: 'overnight', name: 'Overnight', detail: 'Next business day', prices: { rest: 2499 }, freeOver: null, enabled: true },
];

const US_STATES: [string, string][] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'],
  ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'],
  ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'],
  ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'],
  ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'],
  ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
];

const dollars = (cents: number | undefined | null): string =>
  cents == null ? '' : (cents / 100).toFixed(2).replace(/\.00$/, '');
const toCents = (s: string): number | null => {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
const newId = (p: string): string => p + '-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);

/** The price a method charges in a zone, honouring the legacy flat `amount`
 *  for the rest zone. `null` = not offered in that zone. */
function priceIn(m: Method, zoneId: string): number | null {
  if (m.prices && zoneId in m.prices) return m.prices[zoneId];
  if (zoneId === 'rest' && typeof m.amount === 'number') return m.amount;
  return null;
}

export function ShippingSettings() {
  const form = useSettingsForm<Record<string, unknown>>();

  const savedZones = (form.value.shippingZones as Zone[] | undefined) ?? [];
  const custom = savedZones.filter((z) => !z.isRest && z.id !== 'rest');
  const zones: Zone[] = [REST, ...custom];
  const methods = ((form.value.shippingMethods as Method[] | undefined) ?? DEFAULT_METHODS).map((m) => ({
    ...m,
    prices: m.prices ?? {},
  }));
  const pickup: Pickup = (form.value.pickup as Pickup | undefined) ?? { enabled: false, price: 0, address: '', note: '' };
  const freeOver = (form.value.freeShippingOver as number | undefined) ?? 0;

  // Always persist REST first, so the engine's resolveZone fallback finds it.
  const writeZones = (nextCustom: Zone[]) => form.set('shippingZones', [REST, ...nextCustom]);
  const writeMethods = (next: Method[]) => form.set('shippingMethods', next);

  const addZone = () => writeZones([...custom, { id: newId('zone'), name: '', states: [] }]);
  const renameZone = (id: string, name: string) => writeZones(custom.map((z) => (z.id === id ? { ...z, name } : z)));
  const toggleState = (id: string, st: string) =>
    writeZones(
      custom.map((z) =>
        z.id === id ? { ...z, states: z.states.includes(st) ? z.states.filter((s) => s !== st) : [...z.states, st] } : z,
      ),
    );
  const removeZone = (id: string) => {
    writeZones(custom.filter((z) => z.id !== id));
    // Drop that zone's column from every method so no orphan price lingers.
    writeMethods(
      methods.map((m) => {
        const { [id]: _drop, ...rest } = m.prices;
        return { ...m, prices: rest };
      }),
    );
  };

  const setMethod = (id: string, patch: Partial<Method>) =>
    writeMethods(methods.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const setPrice = (id: string, zoneId: string, raw: string) => {
    const cents = toCents(raw);
    writeMethods(
      methods.map((m) => {
        if (m.id !== id) return m;
        const prices = { ...m.prices };
        if (cents == null) delete prices[zoneId];
        else prices[zoneId] = cents;
        return { ...m, prices, amount: undefined };
      }),
    );
  };
  const addMethod = () =>
    writeMethods([...methods, { id: newId('m'), name: 'New method', detail: '', prices: {}, freeOver: null, enabled: true }]);
  const removeMethod = (id: string) => writeMethods(methods.filter((m) => m.id !== id));

  const setPickup = (patch: Partial<Pickup>) => form.set('pickup', { ...pickup, ...patch });

  const cell: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid var(--hairline, #e5e7eb)', verticalAlign: 'middle' };
  const priceInput: React.CSSProperties = { width: 74, textAlign: 'right' };

  return (
    <div className="settings-group">
      <h3 className="settings-group-title">Shipping</h3>
      <p className="settings-group-desc">
        Group states into named zones, then price each delivery method per zone. At checkout a shopper is
        offered every method that has a price for their zone. Carts that ship entirely from one connected
        vendor (Printful) are quoted that vendor&rsquo;s live rates instead; these are the rates for everything else.
      </p>

      {/* ── ZONES ─────────────────────────────────────────────────────────── */}
      <div className="settings-toggle-row settings-toggle-row--stack">
        <div className="settings-toggle-row-text">
          <span className="settings-toggle-row-label">Zones</span>
          <span className="settings-toggle-row-desc">
            Rest of US always exists and catches every state you don&rsquo;t place in a named zone.
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
          {custom.map((z) => (
            <div key={z.id} style={{ border: '1px solid var(--hairline, #e5e7eb)', borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <input
                  className="settings-select"
                  type="text"
                  placeholder="Zone name (e.g. West Coast)"
                  value={z.name}
                  onChange={(e) => renameZone(z.id, e.target.value)}
                  style={{ flex: 1 }}
                />
                <button type="button" className="th-btn th-btn--xs" onClick={() => removeZone(z.id)}>
                  Remove
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                {US_STATES.map(([code, name]) => {
                  const on = z.states.includes(code);
                  // A state can only live in one named zone — show it disabled elsewhere.
                  const takenBy = custom.find((o) => o.id !== z.id && o.states.includes(code));
                  return (
                    <label
                      key={code}
                      title={takenBy ? `Already in ${takenBy.name || 'another zone'}` : name}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, opacity: takenBy ? 0.35 : 1 }}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!!takenBy}
                        onChange={() => toggleState(z.id, code)}
                      />
                      {code}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          <div>
            <button type="button" className="th-btn" onClick={addZone}>
              + Add zone
            </button>
          </div>
        </div>
      </div>

      {/* ── METHOD × ZONE PRICE GRID ──────────────────────────────────────── */}
      <div className="settings-toggle-row settings-toggle-row--stack">
        <div className="settings-toggle-row-text">
          <span className="settings-toggle-row-label">Methods &amp; prices</span>
          <span className="settings-toggle-row-desc">
            A price of 0 is Free. Leave a cell blank to not offer that method in that zone.
          </span>
        </div>
        <div style={{ width: '100%', overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, minWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ ...cell, textAlign: 'left', minWidth: 150 }}>Method</th>
                {zones.map((z) => (
                  <th key={z.id} style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {z.name || 'Zone'}
                  </th>
                ))}
                <th style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>Free over</th>
                <th style={{ ...cell, width: 32 }} aria-label="Enabled" />
                <th style={{ ...cell, width: 32 }} />
              </tr>
            </thead>
            <tbody>
              {methods.map((m) => (
                <tr key={m.id} style={{ opacity: m.enabled ? 1 : 0.5 }}>
                  <td style={{ ...cell, textAlign: 'left' }}>
                    <input
                      className="settings-select"
                      type="text"
                      value={m.name}
                      placeholder="Name"
                      onChange={(e) => setMethod(m.id, { name: e.target.value })}
                      style={{ width: '100%', marginBottom: 4 }}
                    />
                    <input
                      className="settings-select"
                      type="text"
                      value={m.detail}
                      placeholder="e.g. 5–7 business days"
                      onChange={(e) => setMethod(m.id, { detail: e.target.value })}
                      style={{ width: '100%', fontSize: 11 }}
                    />
                  </td>
                  {zones.map((z) => (
                    <td key={z.id} style={{ ...cell, textAlign: 'right' }}>
                      <input
                        className="settings-select"
                        type="number"
                        min={0}
                        step="0.01"
                        inputMode="decimal"
                        value={dollars(priceIn(m, z.id))}
                        placeholder="—"
                        onChange={(e) => setPrice(m.id, z.id, e.target.value)}
                        style={priceInput}
                      />
                    </td>
                  ))}
                  <td style={{ ...cell, textAlign: 'right' }}>
                    <input
                      className="settings-select"
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      value={dollars(m.freeOver)}
                      placeholder="never"
                      onChange={(e) => setMethod(m.id, { freeOver: toCents(e.target.value) })}
                      style={priceInput}
                    />
                  </td>
                  <td style={{ ...cell, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={m.enabled}
                      aria-label="Offer this method"
                      onChange={(e) => setMethod(m.id, { enabled: e.target.checked })}
                    />
                  </td>
                  <td style={{ ...cell, textAlign: 'center' }}>
                    <button
                      type="button"
                      className="th-btn th-btn--xs"
                      aria-label={'Remove ' + m.name}
                      onClick={() => removeMethod(m.id)}
                      style={{ padding: '2px 8px' }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 8 }}>
            <button type="button" className="th-btn" onClick={addMethod}>
              + Add method
            </button>
          </div>
        </div>
      </div>

      {/* ── FREE SHIPPING THRESHOLD ───────────────────────────────────────── */}
      <div className="settings-toggle-row">
        <div className="settings-toggle-row-text">
          <span className="settings-toggle-row-label">Free Standard over</span>
          <span className="settings-toggle-row-desc">
            Standard ships free once the cart subtotal reaches this. 0 turns it off. Per-method &ldquo;Free over&rdquo; above wins where set.
          </span>
        </div>
        <input
          className="settings-select"
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={freeOver ? dollars(freeOver) : ''}
          placeholder="0"
          onChange={(e) => form.set('freeShippingOver', toCents(e.target.value) ?? 0)}
          style={{ width: 120, textAlign: 'right' }}
        />
      </div>

      {/* ── LOCAL PICKUP ──────────────────────────────────────────────────── */}
      <div className="settings-toggle-row">
        <div className="settings-toggle-row-text">
          <span className="settings-toggle-row-label">Local pickup</span>
          <span className="settings-toggle-row-desc">
            Offer collection in person. Shown at checkout only when every item in the cart is marked pickup-eligible on its product page.
          </span>
        </div>
        <label className="th-switch">
          <input
            type="checkbox"
            checked={pickup.enabled}
            onChange={(e) => setPickup({ enabled: e.target.checked })}
          />
          <span className="th-switch-track" />
        </label>
      </div>
      {pickup.enabled && (
        <div className="settings-toggle-row settings-toggle-row--stack">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <span style={{ width: 90 }}>Fee</span>
              <input
                className="settings-select"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={dollars(pickup.price)}
                placeholder="0 (free)"
                onChange={(e) => setPickup({ price: toCents(e.target.value) ?? 0 })}
                style={{ width: 120, textAlign: 'right' }}
              />
            </label>
            <input
              className="settings-select"
              type="text"
              value={pickup.address}
              placeholder="Pickup address (shown after they choose it)"
              onChange={(e) => setPickup({ address: e.target.value })}
            />
            <input
              className="settings-select"
              type="text"
              value={pickup.note}
              placeholder="Note, e.g. “Ready in 2 hours, bring your order number”"
              onChange={(e) => setPickup({ note: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
