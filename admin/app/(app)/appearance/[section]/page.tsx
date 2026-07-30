import { notFound } from 'next/navigation';
import { apiGet } from '../../../../lib/api';
import { DEFAULT_APPEARANCE, type Appearance } from '../../../../lib/appearance';
import { APPEARANCE_SECTIONS } from '../../../../lib/appearanceSections';
import { Choice, ColorField, Segmented, Stepper, Switch } from '../AppearanceControls';

export const dynamic = 'force-dynamic';

// One section at a time, same as every Settings domain. This was a single
// 3-column card board holding all 50 controls, which read as a different
// product sitting next to Settings.

const FONT_OPTIONS: [string, string][] = [
  ['', 'Theme default'],
  ['Inter Tight', 'Inter Tight'],
  ['Inter', 'Inter'],
  ['system-ui', 'System UI'],
  ['Georgia', 'Georgia'],
  ['IBM Plex Sans', 'IBM Plex Sans'],
];

const MONO_OPTIONS: [string, string][] = [
  ['', 'Theme default'],
  ['JetBrains Mono', 'JetBrains Mono'],
  ['IBM Plex Mono', 'IBM Plex Mono'],
  ['ui-monospace', 'System mono'],
];

const SECTIONS: Record<string, { title: string; sub: string; render: (a: Appearance) => React.ReactNode }> = {
  theme: {
    title: 'Theme',
    sub: 'The base look everything else builds on.',
    render: (a: Appearance) => (
      <>
          <Segmented
            label="Color mode"
            field="colorMode"
            initial={a.colorMode}
            options={[['light', 'Light'], ['dark', 'Dark'], ['system', 'System']]}
          />
          <ColorField
            label="Accent"
            help="Buttons, links, active states."
            field="accent"
            initial={a.accent}
            fallback="#e83b3b"
          />
          <Segmented
            label="Accent intensity"
            help="How hard the accent colour is pushed."
            field="intensity"
            initial={a.intensity}
            options={[['subtle', 'Subtle'], ['normal', 'Normal'], ['vivid', 'Vivid']]}
          />
          <Segmented
            label="Background"
            field="background"
            initial={a.background}
            options={[['solid', 'Solid'], ['subtle-gradient', 'Gradient']]}
          />
      </>
    ),
  },
  layout: {
    title: 'Layout',
    sub: 'Spacing and the shape of the shell.',
    render: (a: Appearance) => (
      <>
          <Segmented
            label="Density"
            help="Breathing room in nav, list rows and card padding."
            field="density"
            initial={a.density}
            options={[['compact', 'Compact'], ['comfortable', 'Comfortable'], ['breathing', 'Breathing']]}
          />
          <Segmented
            label="Content width"
            field="contentWidth"
            initial={a.contentWidth}
            options={[['full', 'Full'], ['normal', 'Normal'], ['narrow', 'Narrow']]}
          />
          <Segmented
            label="Card grid gap"
            field="cardGridGap"
            initial={a.cardGridGap}
            options={[['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']]}
          />
          <Segmented
            label="Topbar"
            help="Sticky keeps it in view while you scroll."
            field="topbarBehavior"
            initial={a.topbarBehavior}
            options={[['default', 'Default'], ['sticky', 'Sticky']]}
          />
      </>
    ),
  },
  sidebar: {
    title: 'Sidebar',
    sub: 'The left rail.',
    render: (a: Appearance) => (
      <>
          <Choice
            label="Style"
            field="sidebarStyle"
            initial={a.sidebarStyle}
            options={[
              ['default', 'Default'],
              ['pills', 'Pills'],
              ['floating', 'Floating'],
              ['solid', 'Solid'],
              ['minimal', 'Minimal'],
              ['dividers', 'Dividers'],
            ]}
          />
          <Segmented
            label="Layout"
            help="How nav items render in the sidebar."
            field="sidebarLayout"
            initial={a.sidebarLayout}
            options={[['both', 'Icon + text'], ['icons', 'Icons only'], ['text', 'Text only']]}
          />
          <Switch
            label="Foldable"
            help="Allow the rail to collapse to icons."
            field="sidebarFoldable"
            initial={a.sidebarFoldable}
          />
      </>
    ),
  },
  surfaces: {
    title: 'Surfaces',
    sub: 'Cards, dropdowns and modals.',
    render: (a: Appearance) => (
      <>
          <Segmented
            label="Card style"
            field="cardStyle"
            initial={a.cardStyle}
            options={[['flat', 'Flat'], ['shadow', 'Shadow'], ['glass', 'Glass']]}
          />
          <Segmented
            label="Shadow"
            help="Depth on cards, dropdowns and modals."
            field="shadowStyle"
            initial={a.shadowStyle}
            options={[['none', 'None'], ['subtle', 'Subtle'], ['pronounced', 'Pronounced']]}
          />
          <ColorField
            label="Glass tint"
            help="The frost colour, when card style is Glass."
            field="glassTint"
            initial={a.glassTint}
            fallback="#101010"
          />
          <Segmented
            label="Blur strength"
            help="How much backdrop blur Glass uses."
            field="blurStrength"
            initial={a.blurStrength}
            options={[['light', 'Light'], ['medium', 'Medium'], ['heavy', 'Heavy']]}
          />
          <Switch label="Glass" help="Frosted backdrop on cards and modals." field="glass" initial={a.glass} />
          <Segmented
            label="Glass tint mode"
            help="Auto follows the light/dark toggle. Color uses the tint above."
            field="glassTintMode"
            initial={a.glassTintMode}
            options={[['auto', 'Auto'], ['dark', 'Dark'], ['light', 'Light'], ['color', 'Color']]}
          />
          <Choice
            label="Surface effect"
            help="Backdrop atmosphere for cards, sidebar and topbar. Stacks on any theme."
            field="surfaceEffect"
            initial={a.surfaceEffect}
            options={[
              ['none', 'None'],
              ['glass-light', 'Light Glass'],
              ['glass-dark', 'Dark Glass'],
              ['glass-colored', 'Colored Glass'],
              ['gradient', 'Gradient'],
              ['blurred', 'Blurred'],
            ]}
          />
          <Choice
            label="Background pattern"
            field="bgImage"
            initial={a.bgImage}
            options={[['none', 'None'], ['mesh', 'Mesh'], ['grid', 'Grid'], ['noise', 'Noise'], ['dots', 'Dots']]}
          />
      </>
    ),
  },
  shape: {
    title: 'Shape',
    sub: 'Corners and borders.',
    render: (a: Appearance) => (
      <>
          <Segmented
            label="Corner radius"
            field="cornerRadius"
            initial={a.cornerRadius}
            options={[['sharp', 'Sharp'], ['default', 'Default'], ['round', 'Round']]}
          />
          <Segmented
            label="Border weight"
            field="borderWeight"
            initial={a.borderWeight}
            options={[['thin', 'Thin'], ['default', 'Default'], ['thick', 'Thick']]}
          />
      </>
    ),
  },
  typography: {
    title: 'Typography',
    sub: 'Type family, size and rhythm.',
    render: (a: Appearance) => (
      <>
          <Choice label="Body font" field="bodyFont" initial={a.bodyFont} options={FONT_OPTIONS} />
          <Choice label="Display font" help="Headings." field="displayFont" initial={a.displayFont} options={FONT_OPTIONS} />
          <Choice label="Mono font" help="Code and IDs." field="monoFont" initial={a.monoFont} options={MONO_OPTIONS} />
          <Segmented
            label="Base size"
            field="baseSize"
            initial={a.baseSize}
            options={[['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']]}
          />
          <Segmented
            label="Letter spacing"
            field="letterSpacing"
            initial={a.letterSpacing}
            options={[['tight', 'Tight'], ['normal', 'Normal'], ['wide', 'Wide']]}
          />
          <Segmented
            label="Line height"
            field="lineHeight"
            initial={a.lineHeight}
            options={[['compact', 'Compact'], ['normal', 'Normal'], ['relaxed', 'Relaxed']]}
          />
      </>
    ),
  },
  motion: {
    title: 'Motion',
    sub: 'Animation and transitions.',
    render: (a: Appearance) => (
      <>
          <Switch label="Animations" help="Turn off for a completely static admin." field="motionEnabled" initial={a.motionEnabled} />
          <Segmented
            label="Transition speed"
            field="transitionSpeed"
            initial={a.transitionSpeed}
            options={[['fast', 'Fast'], ['default', 'Default'], ['slow', 'Slow']]}
          />
          <Segmented
            label="Page transition"
            help="How one screen becomes the next. Morph carries shared elements across; Off is instant."
            field="pageTransitions"
            initial={a.pageTransitions}
            options={[['off', 'Off'], ['fade', 'Fade'], ['slide', 'Slide'], ['scale', 'Scale'], ['morph', 'Morph']]}
          />
          <Switch label="Card hover lift" field="hoverLift" initial={a.hoverLift} />
      </>
    ),
  },
  lists: {
    title: 'Lists &amp; cards',
    sub: 'Defaults for Pages, Posts, Media and the rest.',
    render: (a: Appearance) => (
      <>
          <Segmented
            label="Card layout"
            field="cardLayout"
            initial={a.cardLayout}
            options={[['compact', 'Compact'], ['comfortable', 'Comfortable']]}
          />
          <Segmented
            label="Thumbnail source"
            help="Auto falls back to a generated gradient when a page has no cover image."
            field="thumbnailSource"
            initial={a.thumbnailSource}
            options={[['auto', 'Auto'], ['cover-only', 'Cover only']]}
          />
          <Segmented
            label="Default list view"
            field="listViewDefault"
            initial={a.listViewDefault}
            options={[['grid', 'Grid'], ['table', 'Table']]}
          />
          <Stepper label="Items per page" field="itemsPerPage" initial={a.itemsPerPage} min={5} max={100} step={5} />
          <Choice
            label="Card template"
            help="The card shape itself — separate from density and surface above."
            field="cardTemplate"
            initial={a.cardTemplate}
            options={[
              ['hero', 'Hero — full-bleed image, text overlaid'],
              ['detailed', 'Detailed — image, status, meta, author footer'],
              ['list-1', 'List 1 — dense rows, small thumb'],
              ['list-2', 'List 2 — tight list, square thumb'],
              ['list-3', 'List 3 — editorial list, larger thumb'],
            ]}
          />
          <Choice
            label="Card image"
            help="What fills the thumbnail when a card has no cover."
            field="cardImage"
            initial={a.cardImage}
            options={[
              ['gradient', 'Gradient — per-post blend'],
              ['featured', 'Featured image'],
              ['stock', 'Stock photo'],
              ['wireframe', 'Wireframe'],
              ['pattern', 'Pattern'],
            ]}
          />
      </>
    ),
  },
  accessibility: {
    title: 'Accessibility',
    sub: 'Overrides that always win over the theme.',
    render: (a: Appearance) => (
      <>
          <Segmented
            label="Contrast"
            field="contrast"
            initial={a.contrast}
            options={[['normal', 'Normal'], ['high', 'High']]}
          />
          <Switch
            label="Reduce transparency"
            help="Replaces glass and blur with solid surfaces."
            field="reduceTransparency"
            initial={a.reduceTransparency}
          />
          <Switch label="Underline links" field="underlineLinks" initial={a.underlineLinks} />
          <Switch
            label="Always-visible focus rings"
            help="Show the focus ring for mouse users too, not just keyboard."
            field="alwaysVisibleFocusRings"
            initial={a.alwaysVisibleFocusRings}
          />
          <Switch label="Larger click targets" field="largerClickTargets" initial={a.largerClickTargets} />
      </>
    ),
  },
  workspace: {
    title: 'Workspace',
    sub: 'Behaviour of the admin itself.',
    render: (a: Appearance) => (
      <>
          <Switch label="Keyboard shortcuts" field="keyboardShortcuts" initial={a.keyboardShortcuts} />
          <Switch
            label="Debug overlays"
            help="Layout and render diagnostics on top of the chrome."
            field="debugOverlays"
            initial={a.debugOverlays}
          />
          <Switch label="Autosave" help="Save edits as you work, without pressing Save." field="autoSave" initial={a.autoSave} />
          <Switch
            label="Drag grips"
            help="Show the drag handle on reorderable rows and dashboard cards."
            field="showGrips"
            initial={a.showGrips}
          />
          <Switch
            label="Desktop mode"
            help="Render admin screens bare, without the sidebar and topbar."
            field="desktopMode"
            initial={a.desktopMode}
          />
          <Choice
            label="Code editor theme"
            help="Syntax colours in the custom CSS and code fields."
            field="codeEditorTheme"
            initial={a.codeEditorTheme}
            options={[
              ['therum', 'Therum'],
              ['github', 'GitHub'],
              ['monokai', 'Monokai'],
              ['solarized', 'Solarized'],
              ['nord', 'Nord'],
            ]}
          />
          <Stepper label="Bento gap" help="Space between dashboard cards, in px." field="bentoGap" initial={a.bentoGap} min={0} max={48} step={4} />
      </>
    ),
  },
};

export function generateStaticParams() {
  return APPEARANCE_SECTIONS.map((s) => ({ section: s.id }));
}

export default async function AppearanceSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const def = SECTIONS[section];
  if (!def) notFound();

  let a: Appearance;
  let err: string | null = null;
  try {
    a = await apiGet<Appearance>('/api/settings/appearance');
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
    a = DEFAULT_APPEARANCE;
  }

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>{def.title}</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        {def.sub} Saves the moment you change it.
      </p>
      {err && <div className="notice">API offline ({err}) — showing defaults; changes will not save.</div>}
      {def.render(a)}
    </div>
  );
}
