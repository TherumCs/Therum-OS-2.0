import { Prisma } from '@prisma/client';
import { db } from '../lib/db.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { editionService, type Edition } from './edition.service.js';

// Capabilities are native Pure modules (toggleable + provider-selectable). A
// provider's NAME is the product (Counter is Counter native or as the WP
// plugin); `distribution` is the build. In Pure, only native providers are
// usable; Unlocked unlocks the ecosystem/platform/custom ones (pairing).
export interface CapabilityProvider {
  id: string;
  name: string;
  foundation: string;
  status: 'stable' | 'planned';
  distribution: 'native' | 'ecosystem' | 'platform' | 'custom';
  version?: string;
}

interface CapabilityDef {
  id: string;
  name: string;
  description: string;
  providers: CapabilityProvider[];
}

const CATALOG: CapabilityDef[] = [
  {
    id: 'commerce',
    name: 'Commerce',
    description: 'One product entity with capability toggles, unified cart/checkout, typed events. Pluggable payment/tax/shipping/fulfillment.',
    providers: [
      { id: 'counter', name: 'Counter', foundation: 'native', status: 'stable', distribution: 'native' },
      { id: 'counter-wp', name: 'Counter', foundation: 'wordpress', status: 'stable', distribution: 'ecosystem', version: '1.x' },
    ],
  },
  {
    id: 'connections',
    name: 'Connections',
    description: 'Connect CMS platforms, ecommerce stores, and APIs; per-connector config + saved credentials.',
    providers: [
      { id: 'nexus', name: 'Nexus', foundation: 'native', status: 'planned', distribution: 'native' },
      { id: 'nexus-wp', name: 'Nexus', foundation: 'wordpress', status: 'stable', distribution: 'ecosystem', version: '1.x' },
    ],
  },
  {
    id: 'merged-products',
    name: 'Merged Products',
    description: 'Group products from multiple sources into one customer-facing product; route each combo to the right source.',
    providers: [
      // 2.0 schema already models this (Product.vendorId nullable, variant.sourceVendorId) — merge logic/UI pending.
      { id: 'cluster', name: 'Cluster', foundation: 'native', status: 'stable', distribution: 'native' },
      { id: 'cluster-wp', name: 'Cluster', foundation: 'wordpress', status: 'stable', distribution: 'ecosystem', version: '1.x' },
    ],
  },
  {
    id: 'memberships',
    name: 'Memberships',
    description: 'Named member groups with capabilities, discounts, expiry, custom registration links, and member lists.',
    providers: [
      { id: 'milieus', name: 'Milieus', foundation: 'native', status: 'stable', distribution: 'native' },
      { id: 'milieus-wp', name: 'Milieus', foundation: 'wordpress', status: 'stable', distribution: 'ecosystem', version: '1.x' },
    ],
  },
  {
    id: 'content',
    name: 'Content',
    description: 'Pages, blog, case studies, SEO, media.',
    providers: [
      { id: 'folio', name: 'Folio', foundation: 'native', status: 'stable', distribution: 'native' },
      { id: 'wordpress-bricks', name: 'WordPress × Bricks', foundation: 'wordpress', status: 'stable', distribution: 'platform' },
    ],
  },
];

const PREFIX = 'capability:';
const key = (id: string): string => `${PREFIX}${id}`;

function find(id: string): CapabilityDef {
  const cap = CATALOG.find((c) => c.id === id);
  if (!cap) throw new NotFoundError('Capability not found', 'id');
  return cap;
}

// A fresh install should reflect reality: a capability whose native provider
// is already built (`stable`) is genuinely running (Counter, Folio) — it
// should read as ON out of the box, not "off" while secretly serving traffic.
// Capabilities with only a `planned` native provider (Connections/Merged/
// Memberships) default OFF since nothing native exists to serve them yet.
function defaultEnabled(cap: CapabilityDef): boolean {
  return cap.providers.some((p) => p.status === 'stable' && p.distribution === 'native');
}

function defaultProvider(cap: CapabilityDef, edition: Edition): string {
  const nativeStable = cap.providers.find((p) => p.status === 'stable' && p.distribution === 'native');
  if (nativeStable) return nativeStable.id;
  if (edition === 'unlocked') {
    const anyStable = cap.providers.find((p) => p.status === 'stable');
    if (anyStable) return anyStable.id;
  }
  // Pure with no native-stable yet → show the native (planned) slot.
  return (cap.providers.find((p) => p.distribution === 'native') ?? cap.providers[0])?.id ?? '';
}

interface CapState {
  enabled?: boolean;
  provider?: string;
}

async function readState(): Promise<Map<string, CapState>> {
  const rows = await db.extension.findMany({ where: { name: { startsWith: PREFIX } }, select: { name: true, enabled: true, manifest: true } });
  const map = new Map<string, CapState>();
  for (const r of rows) {
    const id = r.name.slice(PREFIX.length);
    const m = r.manifest && typeof r.manifest === 'object' ? (r.manifest as Record<string, unknown>) : {};
    map.set(id, { enabled: r.enabled, provider: typeof m.provider === 'string' ? m.provider : undefined });
  }
  return map;
}

function buildView(cap: CapabilityDef, s: CapState | undefined, edition: Edition) {
  const enabled = s?.enabled ?? defaultEnabled(cap);
  const provider = s?.provider ?? defaultProvider(cap, edition);
  const providers = cap.providers.map((p) => {
    const locked = edition === 'pure' && p.distribution !== 'native';
    return { ...p, locked, selectable: p.status === 'stable' && !locked };
  });
  if (provider && !providers.some((p) => p.id === provider)) {
    const locked = edition === 'pure'; // custom builds are a pairing → Unlocked only
    providers.push({ id: provider, name: provider, foundation: 'custom', status: 'stable', distribution: 'custom', locked, selectable: !locked });
  }
  const chosen = providers.find((p) => p.id === provider);
  const active = enabled && chosen?.selectable ? provider : null;
  return { id: cap.id, name: cap.name, description: cap.description, enabled, provider, active, providers };
}

async function upsert(id: string, data: CapState): Promise<void> {
  const name = key(id);
  const existing = await db.extension.findUnique({ where: { name }, select: { manifest: true } });
  const base = existing?.manifest && typeof existing.manifest === 'object' ? (existing.manifest as Record<string, unknown>) : {};
  const manifest = { ...base, kind: 'capability', ...(data.provider !== undefined ? { provider: data.provider } : {}) };
  await db.extension.upsert({
    where: { name },
    update: { ...(data.enabled !== undefined ? { enabled: data.enabled } : {}), manifest: manifest as unknown as Prisma.InputJsonValue },
    create: { name, version: '1.0.0', enabled: data.enabled ?? false, manifest: manifest as unknown as Prisma.InputJsonValue, health: 'ok' },
  });
}

export const capabilityService = {
  // Cheap boolean check for the route guard — same default rule as buildView,
  // without resolving providers/edition-locking (that's display-only work).
  async isEnabled(id: string): Promise<boolean> {
    const cap = find(id);
    const row = await db.extension.findUnique({ where: { name: key(id) }, select: { enabled: true } });
    return row ? row.enabled : defaultEnabled(cap);
  },

  async list() {
    const [st, edition] = await Promise.all([readState(), editionService.get()]);
    return CATALOG.map((cap) => buildView(cap, st.get(cap.id), edition));
  },

  async get(id: string) {
    find(id);
    const [st, edition] = await Promise.all([readState(), editionService.get()]);
    return buildView(find(id), st.get(id), edition);
  },

  async setEnabled(id: string, enabled: boolean) {
    find(id);
    await upsert(id, { enabled });
    return this.get(id);
  },

  async setProvider(id: string, providerId: string) {
    const cap = find(id);
    const edition = await editionService.get();
    const inCatalog = cap.providers.find((p) => p.id === providerId);
    if (inCatalog && inCatalog.status !== 'stable') throw new ValidationError('That provider is planned, not selectable yet.', 'provider');
    if (!inCatalog && !/^[a-z0-9][a-z0-9-]{1,48}$/.test(providerId)) throw new ValidationError('Invalid provider id.', 'provider');
    const isNative = inCatalog?.distribution === 'native';
    if (edition === 'pure' && !isNative) throw new ValidationError('That provider requires Unlocked — Pure is locked to native providers.', 'provider');
    await upsert(id, { provider: providerId });
    return this.get(id);
  },
};
