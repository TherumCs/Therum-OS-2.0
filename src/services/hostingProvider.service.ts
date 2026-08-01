import { connectionService } from './connection.service.js';
import { ValidationError } from '../lib/errors.js';
import { db } from '../lib/db.js';

// Out-of-band control of the box itself.
//
// The Server panel runs ON the machine, which means it dies WITH the machine.
// If the VPS is wedged, out of memory, or firewalled against itself, nothing
// under /tos-admin answers — and the one moment you most want a restart button
// is the moment that button cannot exist. This talks to the hosting provider's
// own API instead, from wherever this code happens to be running, so a hard
// restart and a snapshot restore stay reachable when the box is not.
//
// Provider-agnostic in the same way catalogSync is: a provider turns its own
// API into the shape below and nothing else. Hostinger is the first because it
// is the box Bam bought; the interesting logic is not Hostinger's.
//
// Endpoints and auth verified against Hostinger's own published tool list
// (npm `hostinger-api-mcp` 1.26.0, src/core/tools/vps.js) rather than a blog
// post: base https://developers.hostinger.com, `Authorization: Bearer <token>`,
// token from hPanel > Dev Tools > API. Their API is in beta and says so, which
// is exactly why the failure path below reports what came back verbatim.

export interface VpsSummary {
  id: string;
  name: string;
  state: string;
  ipv4: string | null;
  plan: string | null;
  /** Provider's own datacentre label, when it gives one. */
  region: string | null;
}

export interface VpsSnapshot {
  id: string | null;
  createdAt: string | null;
}

/** What every hosting provider must be able to do to earn an entry. */
export interface HostingProvider {
  id: string;
  label: string;
  /** Where the operator goes to mint the credential. Shown when disconnected. */
  tokenSource: string;
  list(credential: string): Promise<VpsSummary[]>;
  /** Power actions. `restart` is a hard reset — the box is not asked nicely. */
  power(credential: string, vpsId: string, action: 'start' | 'stop' | 'restart'): Promise<string>;
  snapshot(credential: string, vpsId: string): Promise<VpsSnapshot | null>;
  createSnapshot(credential: string, vpsId: string): Promise<string>;
}

const TIMEOUT_MS = 20_000;

async function hostingerFetch<T>(credential: string, path: string, method = 'GET'): Promise<T> {
  const res = await fetch(`https://developers.hostinger.com${path}`, {
    method,
    headers: { authorization: `Bearer ${credential}`, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text.slice(0, 300) };
  }
  if (!res.ok) {
    // Verbatim, not summarised. A beta API's own error message is the most
    // useful thing on the screen when something does not work.
    const m = (body as { message?: string; error?: string }).message ?? (body as { error?: string }).error;
    throw new ValidationError(`Hostinger ${method} ${path} → ${res.status}${m ? `: ${m}` : ''}`);
  }
  return body as T;
}

/** Their payloads nest differently per endpoint; read defensively. */
const pick = <T>(v: unknown, ...keys: string[]): T | null => {
  let cur: unknown = v;
  for (const k of keys) {
    if (cur && typeof cur === 'object' && k in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[k];
    else return null;
  }
  return (cur ?? null) as T | null;
};

const hostinger: HostingProvider = {
  id: 'hostinger',
  label: 'Hostinger',
  tokenSource: 'hPanel → Dev Tools → API → Generate Token',

  async list(credential) {
    const raw = await hostingerFetch<unknown>(credential, '/api/vps/v1/virtual-machines');
    const rows = Array.isArray(raw) ? raw : (pick<unknown[]>(raw, 'data') ?? []);
    return rows.map((r) => {
      const o = r as Record<string, unknown>;
      return {
        id: String(o['id'] ?? ''),
        name: String(o['hostname'] ?? o['name'] ?? 'VPS'),
        state: String(o['state'] ?? o['status'] ?? 'unknown'),
        ipv4: pick<string>(o, 'ipv4', '0', 'address') ?? (Array.isArray(o['ipv4']) ? String((o['ipv4'] as Record<string, unknown>[])[0]?.['address'] ?? '') || null : null),
        plan: (o['plan'] as string | undefined) ?? null,
        region: pick<string>(o, 'data_center', 'name') ?? (o['data_center'] as string | undefined) ?? null,
      };
    });
  },

  async power(credential, vpsId, action) {
    await hostingerFetch(credential, `/api/vps/v1/virtual-machines/${encodeURIComponent(vpsId)}/${action}`, 'POST');
    return action === 'restart'
      ? 'Restart requested. This is a hard reset at the hypervisor — give it a minute before expecting the site back.'
      : `${action} requested.`;
  },

  async snapshot(credential, vpsId) {
    const raw = await hostingerFetch<unknown>(credential, `/api/vps/v1/virtual-machines/${encodeURIComponent(vpsId)}/snapshot`).catch(() => null);
    if (!raw) return null;
    const o = (pick<Record<string, unknown>>(raw, 'data') ?? raw) as Record<string, unknown>;
    if (!o || Object.keys(o).length === 0) return null;
    return { id: o['id'] ? String(o['id']) : null, createdAt: (o['created_at'] as string | undefined) ?? null };
  },

  async createSnapshot(credential, vpsId) {
    await hostingerFetch(credential, `/api/vps/v1/virtual-machines/${encodeURIComponent(vpsId)}/snapshot`, 'POST');
    // Hostinger keeps ONE snapshot per machine — taking a new one replaces the
    // old one. Said plainly here because "snapshot created" implies a history
    // that does not exist, and someone will rely on it.
    return 'Snapshot started. Hostinger keeps one snapshot per machine, so this REPLACES any previous one.';
  },
};

export const HOSTING_PROVIDERS: HostingProvider[] = [hostinger];

export const hostingProviderService = {
  /** Registered providers and whether a credential exists for each. */
  async providers(): Promise<{ id: string; label: string; tokenSource: string; connected: boolean }[]> {
    return Promise.all(
      HOSTING_PROVIDERS.map(async (p) => ({
        id: p.id,
        label: p.label,
        tokenSource: p.tokenSource,
        connected: (await connectionService.credentialFor(p.id)) !== null,
      })),
    );
  },

  provider(id: string): HostingProvider {
    const p = HOSTING_PROVIDERS.find((x) => x.id === id);
    if (!p) throw new ValidationError(`Unknown hosting provider "${id}".`);
    return p;
  },

  async credential(id: string): Promise<string> {
    const cred = await connectionService.credentialFor(id);
    if (!cred) throw new ValidationError(`${this.provider(id).label} is not connected. Add it in Connections first.`);
    return cred;
  },

  async list(providerId: string): Promise<VpsSummary[]> {
    return this.provider(providerId).list(await this.credential(providerId));
  },

  /**
   * Power and snapshot actions, audited in the same log as the on-box ones.
   *
   * Same row shape deliberately: "who restarted the server" is one question,
   * and it should have one answer whether the restart went through the panel
   * on the box or around it.
   */
  async act(
    providerId: string,
    vpsId: string,
    action: 'start' | 'stop' | 'restart' | 'snapshot',
    actorId?: string | null,
  ): Promise<{ ok: boolean; output: string }> {
    const provider = this.provider(providerId);
    const started = Date.now();

    // Write-ahead, for the same reason the on-box actions do it — more so
    // here. A restart through the provider takes the whole machine, including
    // the process trying to record that it asked for one.
    const row = await db.hostActionLog
      .create({ data: { actionId: `${providerId}:${action}`, actorId: actorId ?? null, status: 'running' } })
      .catch(() => null);

    let ok = true;
    let output: string;
    try {
      const credential = await this.credential(providerId);
      output =
        action === 'snapshot'
          ? await provider.createSnapshot(credential, vpsId)
          : await provider.power(credential, vpsId, action);
    } catch (e) {
      ok = false;
      output = e instanceof Error ? e.message : String(e);
    }
    if (row) {
      await db.hostActionLog
        .update({
          where: { id: row.id },
          data: { status: ok ? 'ok' : 'failed', ok, output, durationMs: Date.now() - started, finishedAt: new Date() },
        })
        .catch(() => undefined);
    }
    return { ok, output };
  },
};
