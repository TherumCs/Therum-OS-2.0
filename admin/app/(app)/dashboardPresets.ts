// Whole-dashboard layout presets — the "view the dashboard in various ways"
// surface. A preset only restates card SIZES; card order and which cards you
// have stay yours, so switching presets is never destructive.
//
// Sizes are the same xs/sm/md/lg tiers the corner-drag snaps to (3/6/9/12 of
// the 12-column bento grid). `'*'` is the fallback for any card the preset
// doesn't name — which is what keeps a preset working when new cards land.

export interface DashboardPreset {
  label: string;
  hint: string;
  sizes: Record<string, string>;
}

export const DASHBOARD_PRESETS = {
  bento: {
    label: 'Bento',
    hint: 'Mixed sizes — stats small, activity wide',
    sizes: { '*': 'xs', 'recent-activity': 'md' },
  },
  compact: {
    label: 'Compact',
    hint: 'Every card at its smallest — most cards per screen',
    sizes: { '*': 'xs' },
  },
  focus: {
    label: 'Focus',
    hint: 'Counts stay small, activity and health go full width',
    sizes: { '*': 'xs', 'recent-activity': 'lg', 'site-health': 'lg' },
  },
  stacked: {
    label: 'Stacked',
    hint: 'One full-width card per row, every detail expanded',
    sizes: { '*': 'lg' },
  },
} satisfies Record<string, DashboardPreset>;

export type PresetKey = keyof typeof DASHBOARD_PRESETS;

export function isPresetKey(value: string): value is PresetKey {
  return Object.hasOwn(DASHBOARD_PRESETS, value);
}

/** Which preset the current layout already matches, if any. */
export function activePreset(layout: { id: string; size: string }[]): PresetKey | null {
  for (const [key, preset] of Object.entries(DASHBOARD_PRESETS) as [PresetKey, DashboardPreset][]) {
    const matches = layout.every((c) => c.size === (preset.sizes[c.id] ?? preset.sizes['*'] ?? c.size));
    if (matches) return key;
  }
  return null;
}
