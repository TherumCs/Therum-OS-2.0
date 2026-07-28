import type { IconName } from '../app/(app)/icons';

export interface AppearanceSection {
  id: string;
  label: string;
  description: string;
  icon: IconName;
}

// Appearance is its own surface, not one of the 16 Settings sections (see
// settingsSections.ts's header for why) — but it is the same SHAPE: a rail of
// sections beside a content pane. It briefly rendered as a 3-column card
// board instead, which read as a different product from the page next to it.
// Same registry pattern, same components, same CSS classes.
export const APPEARANCE_SECTIONS: AppearanceSection[] = [
  { id: 'theme', label: 'Theme', description: 'Colour mode, accent, background.', icon: 'palette' },
  { id: 'layout', label: 'Layout', description: 'Density, content width, topbar.', icon: 'dashboard' },
  { id: 'sidebar', label: 'Sidebar', description: 'Style and layout of the left rail.', icon: 'menus' },
  { id: 'surfaces', label: 'Surfaces', description: 'Cards, glass, shadow, backdrop.', icon: 'themes' },
  { id: 'shape', label: 'Shape', description: 'Corner radius and border weight.', icon: 'widgets' },
  { id: 'typography', label: 'Typography', description: 'Type family, size, rhythm.', icon: 'edit' },
  { id: 'motion', label: 'Motion', description: 'Animation and transitions.', icon: 'clock' },
  { id: 'lists', label: 'Lists & cards', description: 'Defaults for content list screens.', icon: 'post' },
  { id: 'accessibility', label: 'Accessibility', description: 'Contrast, focus, targets.', icon: 'shield' },
  { id: 'workspace', label: 'Workspace', description: 'Autosave, grips, editor theme.', icon: 'settings' },
];
