import type { NavItem, NavSection } from './nav';

export interface SidebarLayoutSection {
  id: string;
  label: string;
}
export interface SidebarLayout {
  sections: SidebarLayoutSection[];
  items: Record<string, string[]>;
}

const UNSORTED_IDS = new Set(['unsorted', 'more']);

// Item ids are the item's href — stable across loads, playing the exact role
// 1.9.44's `match` string (e.g. "page=therum-pages") plays for its nav items.
function itemId(item: NavItem): string {
  return item.href;
}

/**
 * Apply a user's saved sidebar layout to the default nav. Ports
 * therum_apply_sidebar_layout() (mu-plugins/therum-admin.php lines 921-1043)
 * exactly:
 *  - Saved order inside any section is honored first.
 *  - Items the user has explicitly placed anywhere in the saved layout stay
 *    where the user put them.
 *  - Items never referenced by the saved layout auto-appear in their
 *    default-home section, so newly added nav items always show up without
 *    needing a Reset.
 *  - Gated curated sections (Store, Portfolio) are guaranteed to render when
 *    active, even if the user deleted them from the layout.
 *  - Anything still unassigned sweeps into "Unsorted" (self-healing the
 *    legacy 'more' id into 'unsorted', same as the source).
 */
export function applySidebarLayout(defaultNav: NavSection[], layout: SidebarLayout | null | undefined, curatedIds: string[]): NavSection[] {
  if (!layout || !layout.sections || layout.sections.length === 0) return defaultNav;

  const defaultSections = new Map<string, NavSection>();
  const defaultItemsBySection = new Map<string, NavItem[]>();
  const pool = new Map<string, NavItem>();

  for (const sec of defaultNav) {
    defaultSections.set(sec.id, sec);
    defaultItemsBySection.set(sec.id, sec.items);
    for (const it of sec.items) pool.set(itemId(it), it);
  }

  const referenced = new Set<string>();
  for (const iids of Object.values(layout.items ?? {})) {
    for (const iid of iids) if (iid) referenced.add(iid);
  }

  const result: NavSection[] = [];
  const assigned = new Set<string>();

  for (const sec of layout.sections) {
    const sid = sec.id;
    const items: NavItem[] = [];

    // 1. Saved order first.
    for (const iid of layout.items?.[sid] ?? []) {
      if (!pool.has(iid) || assigned.has(iid)) continue;
      items.push(pool.get(iid)!);
      assigned.add(iid);
    }

    // 2. Rescue truly-orphaned defaults (never referenced anywhere) into
    // their default-home section.
    for (const it of defaultItemsBySection.get(sid) ?? []) {
      const iid = itemId(it);
      if (assigned.has(iid) || referenced.has(iid)) continue;
      items.push(it);
      assigned.add(iid);
    }

    if (items.length === 0) continue; // empty saved section renders no header

    result.push({ id: sid, label: sec.label || defaultSections.get(sid)?.label || sid, items });
  }

  // 3. Force-include gated curated sections even if the user deleted them.
  const resultIds = new Set(result.map((r) => r.id));
  for (const cid of curatedIds) {
    if (resultIds.has(cid)) continue;
    const defaultItems = defaultItemsBySection.get(cid) ?? [];
    if (defaultItems.length === 0) continue;
    const bringBack: NavItem[] = [];
    for (const it of defaultItems) {
      const iid = itemId(it);
      if (assigned.has(iid) || referenced.has(iid)) continue;
      bringBack.push(it);
      assigned.add(iid);
    }
    if (bringBack.length === 0) continue; // user explicitly moved everything out — respect that
    const def = defaultSections.get(cid);
    result.unshift({ id: cid, label: def?.label ?? cid, items: bringBack });
  }

  // 4. Sweep true orphans into "Unsorted".
  const orphans: NavItem[] = [];
  for (const [id, it] of pool) {
    if (assigned.has(id) || referenced.has(id)) continue;
    orphans.push(it);
  }
  if (orphans.length > 0) {
    const unsortedIdx = result.findIndex((r) => UNSORTED_IDS.has(r.id));
    if (unsortedIdx === -1) {
      result.push({ id: 'unsorted', label: 'Unsorted', items: orphans });
    } else {
      const existing = result[unsortedIdx]!;
      result[unsortedIdx] = { ...existing, id: 'unsorted', label: 'Unsorted', items: [...existing.items, ...orphans] };
    }
  }

  return result;
}
