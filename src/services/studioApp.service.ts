import { Prisma } from '@prisma/client';
import { db } from '../lib/db.js';
import { NotFoundError } from '../lib/errors.js';

// A Studio App is a self-contained feature module that shows up under "From
// the Studio" and, once enabled, reveals its own nav entry + settings area —
// distinct from a Foundation (builder/CMS-compat layer, edition-gated) and a
// Capability (a feature resolving to a swappable provider). Not edition-
// gated: apps here are native Therum features, not WP/Bricks compat, so
// Pure vs Unlocked doesn't apply the way it does to Foundations.
export interface StudioApp {
  id: string;
  name: string;
  description: string;
  navLabel: string;
  navHref: string;
  // True when this app's nav entry lives in a CURATED sidebar section
  // (e.g. Case Studies owns the Portfolio section) — the layout then skips
  // the generic Studio-section injection so the entry isn't duplicated.
  curatedSection?: boolean;
}

const CATALOG: StudioApp[] = [
  {
    id: 'nexus',
    name: 'Nexus',
    description: 'Connect AI tools, payments, messaging, ecommerce, and external apps — one hub, 67 providers.',
    navLabel: 'Nexus',
    navHref: '/settings/connections',
  },
  {
    id: 'milieus',
    name: 'Milieus',
    description: 'Named member groups — discounts, expiry, registration links, and member lists for your customers.',
    navLabel: 'Milieus',
    navHref: '/milieus',
  },
  {
    id: 'cluster',
    name: 'Cluster',
    description: 'Merge products from multiple sources into one customer-facing product — every combo routed to the right source.',
    navLabel: 'Cluster',
    navHref: '/clusters',
  },
  {
    id: 'bricks-bridge',
    name: 'Bricks Bridge',
    description: 'Use Bricks without WordPress — import Bricks designs as native, Builder-editable pages; export any canvas page back to Bricks template JSON.',
    navLabel: 'Bricks Bridge',
    navHref: '/bricks',
  },
  {
    id: 'case-studies',
    name: 'Case Studies',
    description: 'Portfolio functionality — publish case studies of your work with the same canvas, SEO, and publishing flow as pages.',
    navLabel: 'Case Studies',
    navHref: '/case-studies',
    curatedSection: true, // owns the sidebar's Portfolio section
  },
];

const key = (id: string): string => `studioapp:${id}`;

export const studioAppService = {
  catalog(): StudioApp[] {
    return CATALOG;
  },

  async list() {
    const rows = await db.extension.findMany({ where: { name: { in: CATALOG.map((a) => key(a.id)) } }, select: { name: true, enabled: true } });
    const enabled = new Set(rows.filter((r) => r.enabled).map((r) => r.name));
    return CATALOG.map((a) => ({ ...a, enabled: enabled.has(key(a.id)) }));
  },

  async isEnabled(id: string): Promise<boolean> {
    const row = await db.extension.findUnique({ where: { name: key(id) }, select: { enabled: true } });
    return row?.enabled ?? false;
  },

  async setEnabled(id: string, enabled: boolean) {
    const a = CATALOG.find((x) => x.id === id);
    if (!a) throw new NotFoundError('Studio app not found', 'id');
    await db.extension.upsert({
      where: { name: key(id) },
      update: { enabled },
      create: { name: key(id), version: '1.0.0', manifest: { kind: 'studioapp' } as unknown as Prisma.InputJsonValue, enabled, health: 'ok' },
    });
    return { ...a, enabled };
  },
};
