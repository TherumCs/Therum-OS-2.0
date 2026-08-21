// Quick Controls' per-user Behavior-tab + Advanced-tab (custom CSS) fields —
// GET /api/me, PATCH /api/me/behavior + /api/me/custom-css. Small enough
// that 3-way duplication was tolerable at first, but extracted alongside
// Appearance below now that a 3rd consumer (DesktopShell) needs it too.
export interface Behavior {
  loginLandingPage: string | null;
  sidebarFolded: boolean;
  listPageRowCount: number | null;
  customCss: string;
}

// Single shared shape for the site-wide Appearance/Quick-Controls settings
// blob (GET/PATCH /api/settings/appearance) — previously re-declared locally
// in 3 separate files (this shell layout, the old /appearance page, and this
// same fallback object). That was a manageable 5-field duplication; growing
// it to 36 fields by hand in 3 places would be a real drift risk, so it's
// extracted here instead. Mirrors src/services/settings.service.ts's
// `Appearance` interface + `APPEARANCE_DEFAULTS` exactly — keep both in sync.
export interface Appearance {
  density: 'compact' | 'comfortable' | 'breathing';
  sidebarStyle: 'default' | 'pills' | 'floating' | 'solid' | 'minimal' | 'dividers';
  sidebarHighlight: 'band' | 'indicator' | 'underline';
  cardStyle: 'flat' | 'shadow';
  colorMode: 'light' | 'dark' | 'system';
  contrast: 'normal' | 'high';

  accent: string;
  intensity: 'subtle' | 'normal' | 'vivid';

  topbarBehavior: 'default' | 'sticky';
  contentWidth: 'expanded' | 'full' | 'normal' | 'narrow';
  cardGridGap: 'compact' | 'comfortable' | 'spacious';

  background: 'solid' | 'subtle-gradient';
  shadowStyle: 'none' | 'subtle' | 'pronounced';

  bodyFont: string;
  displayFont: string;
  monoFont: string;
  baseSize: 'sm' | 'md' | 'lg';
  letterSpacing: 'tight' | 'normal' | 'wide';
  lineHeight: 'compact' | 'normal' | 'relaxed';

  cornerRadius: 'sharp' | 'default' | 'round';
  borderWeight: 'thin' | 'default' | 'thick';

  motionEnabled: boolean;
  transitionSpeed: 'fast' | 'default' | 'slow';
  pageTransitions: 'off' | 'fade' | 'slide' | 'scale' | 'morph';
  hoverLift: boolean;

  cardLayout: 'compact' | 'comfortable';
  thumbnailSource: 'auto' | 'cover-only';
  listViewDefault: 'grid' | 'table';
  itemsPerPage: number;

  underlineLinks: boolean;
  alwaysVisibleFocusRings: boolean;
  largerClickTargets: boolean;

  keyboardShortcuts: boolean;
  debugOverlays: boolean;

  // Ported from 1.9.44 (2026-07-27) — keep in sync with
  // src/services/settings.service.ts's Appearance + APPEARANCE_DEFAULTS.
  sidebarLayout: 'both' | 'icons' | 'text';
  sidebarFoldable: boolean;

  bgImage: 'none' | 'mesh' | 'grid' | 'noise' | 'dots';

  cardTemplate: 'hero' | 'detailed' | 'list-1' | 'list-2' | 'list-3';
  cardImage: 'gradient' | 'featured' | 'stock' | 'wireframe' | 'pattern';

  bentoGap: number;
  showGrips: boolean;
  desktopMode: boolean;
  codeEditorTheme: 'therum' | 'github' | 'monokai' | 'solarized' | 'nord';
}

export const DEFAULT_APPEARANCE: Appearance = {
  density: 'comfortable',
  sidebarStyle: 'default',
  sidebarHighlight: 'band',
  cardStyle: 'shadow',
  colorMode: 'light',
  contrast: 'normal',

  accent: '',
  intensity: 'normal',

  topbarBehavior: 'default',
  contentWidth: 'full',
  cardGridGap: 'comfortable',

  background: 'solid',
  shadowStyle: 'subtle',

  bodyFont: '',
  displayFont: '',
  monoFont: '',
  baseSize: 'md',
  letterSpacing: 'normal',
  lineHeight: 'normal',

  cornerRadius: 'default',
  borderWeight: 'default',

  motionEnabled: true,
  transitionSpeed: 'default',
  pageTransitions: 'morph',
  hoverLift: true,

  cardLayout: 'comfortable',
  thumbnailSource: 'auto',
  listViewDefault: 'grid',
  itemsPerPage: 20,

  underlineLinks: false,
  alwaysVisibleFocusRings: false,
  largerClickTargets: false,

  keyboardShortcuts: true,
  debugOverlays: false,

  sidebarLayout: 'both',
  sidebarFoldable: false,

  bgImage: 'none',

  cardTemplate: 'hero',
  cardImage: 'gradient',

  bentoGap: 16,
  showGrips: false,
  desktopMode: false,
  codeEditorTheme: 'therum',
};

// data-* attribute values for #th-shell — one shared builder so the "omit
// when at CSS baseline" convention (see therum-tokens.css) can't drift
// between call sites. Every value here is either the literal field value
// (density/cardStyle/etc — therum-tokens.css scopes their
// baseline block as `:root, [data-x='default-value']` so an omitted
// attribute and an explicit default-value attribute render identically) or
// `undefined` for booleans/enums where the non-default case is the only one
// that needs a selector at all.

/** Accepts the old boolean and the new style name; returns a style or nothing. */
export function pageTransitionStyle(v: unknown): string | undefined {
  if (v === true) return 'fade';
  if (v === false || v === 'off' || v == null) return undefined;
  return ['fade', 'slide', 'scale', 'morph'].includes(String(v)) ? String(v) : undefined;
}

export function appearanceDataAttrs(a: Appearance): Record<string, string | undefined> {
  return {
    'data-density': a.density,
    'data-sidebar-style': a.sidebarStyle === 'default' ? undefined : a.sidebarStyle,
    'data-sidebar-highlight': a.sidebarHighlight === 'band' ? undefined : a.sidebarHighlight,
    'data-card-style': a.cardStyle,
    'data-color-mode': a.colorMode === 'light' ? undefined : a.colorMode,
    'data-contrast': a.contrast === 'high' ? 'high' : undefined,

    'data-intensity': a.intensity === 'normal' ? undefined : a.intensity,
    'data-topbar-style': a.topbarBehavior === 'default' ? undefined : a.topbarBehavior,
    'data-content-width': a.contentWidth === 'full' ? undefined : a.contentWidth,
    'data-card-grid-gap': a.cardGridGap === 'comfortable' ? undefined : a.cardGridGap,
    'data-background': a.background === 'solid' ? undefined : a.background,
    'data-shadow-style': a.shadowStyle === 'subtle' ? undefined : a.shadowStyle,
    'data-base-size': a.baseSize === 'md' ? undefined : a.baseSize,
    'data-letter-spacing': a.letterSpacing === 'normal' ? undefined : a.letterSpacing,
    'data-line-height': a.lineHeight === 'normal' ? undefined : a.lineHeight,
    'data-corner-radius': a.cornerRadius === 'default' ? undefined : a.cornerRadius,
    'data-border-weight': a.borderWeight === 'default' ? undefined : a.borderWeight,
    'data-transition-speed': a.transitionSpeed === 'default' ? undefined : a.transitionSpeed,
    'data-card-layout': a.cardLayout === 'comfortable' ? undefined : a.cardLayout,

    'data-motion': a.motionEnabled ? undefined : 'off',
    // The VALUE is the style now, not just on/off — see the view-transition
    // block in globals.css.
    //
    // Coerced HERE as well as in the schema: the schema transform runs on
    // input, so a row written before this change still reads back as the
    // boolean `true` and rendered `data-page-transition="true"`, which matches
    // no selector at all.
    'data-page-transition': pageTransitionStyle(a.pageTransitions),
    'data-hover-lift': a.hoverLift ? undefined : 'off',
    'data-underline-links': a.underlineLinks ? 'on' : undefined,
    'data-always-focus': a.alwaysVisibleFocusRings ? 'on' : undefined,
    'data-larger-targets': a.largerClickTargets ? 'on' : undefined,
    'data-debug-overlays': a.debugOverlays ? 'on' : undefined,

    // Ported from 1.9.44 (2026-07-27). Same convention: omit at baseline so
    // an unset attribute and an explicit default render identically.
    'data-sidebar-layout': a.sidebarLayout === 'both' ? undefined : a.sidebarLayout,
    'data-sidebar-foldable': a.sidebarFoldable ? 'on' : undefined,
    'data-bg-image': a.bgImage === 'none' ? undefined : a.bgImage,
    'data-card-template': a.cardTemplate === 'hero' ? undefined : a.cardTemplate,
    'data-show-grips': a.showGrips ? 'on' : undefined,
    // Defaults on, so only the off case needs a selector.
    'data-code-theme': a.codeEditorTheme === 'therum' ? undefined : a.codeEditorTheme,
    'data-desktop-mode': a.desktopMode ? 'on' : undefined,
    // Defaults on, so only the off case needs a selector.
    'data-shortcuts': a.keyboardShortcuts ? undefined : 'off',
  };
}

// Free-form values (colors, font names) can't be data-attribute-selector-
// scoped — they're arbitrary strings, not a fixed enum — so they go in as
// literal inline CSS custom-property overrides instead. Empty string means
// "no override," matching every free-form field's own '' default above.
export function appearanceInlineVars(a: Appearance): Record<string, string> {
  const vars: Record<string, string> = {};
  // --th-accent-base, not --th-accent: intensity derives the final accent
  // from the base (see therum-tokens.css), so writing --th-accent directly
  // would silently disable Accent intensity for any custom colour.
  if (a.accent) vars['--th-accent-base'] = a.accent;
  // Dashboard bento gap — a free number, so a var rather than an attribute.
  if (a.bentoGap !== 16) vars['--th-bento-gap'] = `${a.bentoGap}px`;
  if (a.bodyFont) vars['--th-font-body'] = a.bodyFont;
  if (a.displayFont) vars['--th-font-display'] = a.displayFont;
  if (a.monoFont) vars['--th-font-mono'] = a.monoFont;
  return vars;
}
