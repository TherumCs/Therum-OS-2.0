'use client';

import { useState } from 'react';

export interface SignalStatus {
  enabled: boolean;
  pixelId: string;
  testEventCode: string;
  pixel: boolean;
  conversionsApi: boolean;
  reason: string | null;
  recent: { at: string; event: string; eventId: string; ok: boolean; detail: string }[];
}

async function call(method: string, path: string, body?: unknown): Promise<SignalStatus & { ok?: boolean; status?: SignalStatus }> {
  const res = await fetch(`/tos-admin/api/${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: { message?: string } }).error?.message ?? 'Request failed.');
  return j;
}

export function SignalClient({ initial }: { initial: SignalStatus }) {
  const [s, setS] = useState<SignalStatus>(initial);
  const [pixelId, setPixelId] = useState(initial.pixelId);
  const [testCode, setTestCode] = useState(initial.testEventCode);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (patch: Partial<SignalStatus>) => {
    setBusy(true);
    setMsg(null);
    try {
      setS(await call('PUT', 'signal', patch));
      setMsg({ ok: true, text: 'Saved.' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not save.' });
    }
    setBusy(false);
  };

  const test = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await call('POST', 'signal/test');
      if (r.status) setS(r.status);
      setMsg(r.ok ? { ok: true, text: 'Meta received the test event. Check Events Manager › Test Events.' } : { ok: false, text: 'Meta did not accept it — see the latest row below.' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Test failed.' });
    }
    setBusy(false);
  };

  const pill = (on: boolean, yes: string, no: string) => <span className={'pill' + (on ? ' pill-ok' : ' pill-failed')}>{on ? yes : no}</span>;

  return (
    <div style={{ display: 'grid', gap: 'var(--th-space-16)', maxWidth: 760 }}>
      <div className="th-card" style={{ padding: 16, display: 'grid', gap: 12 }}>
        <div className="th-card-label">Status</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 'var(--th-fs-sm)' }}>
          Pixel {pill(s.pixel, 'live', 'off')} Conversions API {pill(s.conversionsApi, 'live', 'off')}
        </div>
        {s.reason && <div className="muted" style={{ fontSize: 'var(--th-fs-sm)' }}>{s.reason}</div>}
      </div>

      <div className="th-card" style={{ padding: 16, display: 'grid', gap: 12 }}>
        <div className="th-card-label">Pixel</div>
        <label style={{ display: 'grid', gap: 4, fontSize: 'var(--th-fs-2xs)' }}>
          <span className="muted">Pixel ID (Events Manager › Data sources › your pixel)</span>
          <input value={pixelId} onChange={(e) => setPixelId(e.target.value)} placeholder="123456789012345" inputMode="numeric" style={{ maxWidth: 260 }} />
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="th-btn th-btn-primary" disabled={busy || !pixelId.trim()} onClick={() => void save({ pixelId, enabled: true })}>
            {s.enabled ? 'Save' : 'Save and turn on'}
          </button>
          {s.enabled && (
            <button className="th-btn" disabled={busy} onClick={() => void save({ enabled: false })}>
              Turn off
            </button>
          )}
        </div>
        <div className="muted" style={{ fontSize: 'var(--th-fs-sm)' }}>
          The server token lives in Nexus under <b>Meta Conversions API</b>, stored encrypted like every other credential.
        </div>
      </div>

      <div className="th-card" style={{ padding: 16, display: 'grid', gap: 12 }}>
        <div className="th-card-label">Test</div>
        <label style={{ display: 'grid', gap: 4, fontSize: 'var(--th-fs-2xs)' }}>
          <span className="muted">Test event code (Events Manager › Test events). Clear it when you are done, or real sales are reported as tests.</span>
          <input value={testCode} onChange={(e) => setTestCode(e.target.value)} placeholder="TEST12345" style={{ maxWidth: 200 }} />
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="th-btn" disabled={busy} onClick={() => void save({ testEventCode: testCode })}>
            Save code
          </button>
          <button className="th-btn" disabled={busy || !s.conversionsApi} onClick={() => void test()}>
            Send a test event
          </button>
        </div>
      </div>

      {msg && <div className={msg.ok ? 'notice' : ''} style={msg.ok ? { margin: 0 } : { color: 'var(--th-danger-text)', fontSize: 13 }}>{msg.text}</div>}

      <div className="th-card" style={{ padding: 16, display: 'grid', gap: 8 }}>
        <div className="th-card-label">Recent server events</div>
        {s.recent.length === 0 ? (
          <div className="muted" style={{ fontSize: 'var(--th-fs-sm)' }}>None yet. Each paid order sends a Purchase here.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {s.recent.map((r) => (
                <tr key={r.eventId + r.at}>
                  <td style={{ fontSize: 'var(--th-fs-2xs)', whiteSpace: 'nowrap' }}>{new Date(r.at).toLocaleString()}</td>
                  <td style={{ fontSize: 'var(--th-fs-2xs)' }}>{r.event}</td>
                  <td>{pill(r.ok, r.detail, r.detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
