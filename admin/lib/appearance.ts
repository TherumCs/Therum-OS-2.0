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
  sidebarStyle: 'default' | 'pills' | 'minimal';
  cardStyle: 'flat' | 'shadow' | 'glass';
  colorMode: 'light' | 'dark' | 'system';
  contrast: 'normal' | 'high';

  accent: string;
  intensity: 'subtle' | 'normal' | 'vivid';

  topbarBehavior: 'default' | 'sticky';
  contentWidth: 'full' | 'normal' | 'narrow';
  cardGridGap: 'compact' | 'comfortable' | 'spacious';

  glassTint: string;
  blurStrength: 'light' | 'medium' | 'heavy';
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
  pageTransitions: boolean;
  hoverLift: boolean;

  cardLayout: 'compact' | 'comfortable';
  thumbnailSource: 'auto' | 'cover-only';
  listViewDefault: 'grid' | 'table';
  itemsPerPage: number;

  reduceTransparency: boolean;
  underlineLinks: boolean;
  alwaysVisibleFocusRings: boolean;
  largerClickTargets: boolean;

  keyboardShortcuts: boolean;
  debugOverlays: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  density: 'comfortable',
  sidebarStyle: 'default',
  cardStyle: 'shadow',
  colorMode: 'light',
  contrast: 'normal',

  accent: '',
  intensity: 'normal',

  topbarBehavior: 'default',
  contentWidth: 'full',
  cardGridGap: 'comfortable',

  glassTint: '',
  blurStrength: 'medium',
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
  pageTransitions: false,
  hoverLift: true,

  cardLayout: 'comfortable',
  thumbnailSource: 'auto',
  listViewDefault: 'grid',
  itemsPerPage: 20,

  reduceTransparency: false,
  underlineLinks: false,
  alwaysVisibleFocusRings: false,
  largerClickTargets: false,

  keyboardShortcuts: true,
  debugOverlays: false,
};

// data-* attribute values for #th-shell — one shared builder so the "omit
// when at CSS baseline" convention (see therum-tokens.css) can't drift
// between call sites. Every value here is either the literal field value
// (density/cardStyle/blurStrength/etc — therum-tokens.css scopes their
// baseline block as `:root, [data-x='default-value']` so an omitted
// attribute and an explicit default-value attribute render identically) or
// `undefined` for booleans/enums where the non-default case is the only one
// that needs a selector at all.
export function appearanceDataAttrs(a: Appearance): Record<string, string | undefined> {
  return {
    'data-density': a.density,
    'data-sidebar-style': a.sidebarStyle === 'default' ? undefined : a.sidebarStyle,
    'data-card-style': a.cardStyle,
    'data-color-mode': a.colorMode === 'light' ? undefined : a.colorMode,
    'data-contrast': a.contrast === 'high' ? 'high' : undefined,

    'data-intensity': a.intensity === 'normal' ? undefined : a.intensity,
    'data-topbar-style': a.topbarBehavior === 'default' ? undefined : a.topbarBehavior,
    'data-content-width': a.contentWidth === 'full' ? undefined : a.contentWidth,
    'data-card-grid-gap': a.cardGridGap === 'comfortable' ? undefined : a.cardGridGap,
    'data-blur-strength': a.blurStrength === 'medium' ? undefined : a.blurStrength,
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
    'data-page-transitions': a.pageTransitions ? 'on' : undefined,
    'data-hover-lift': a.hoverLift ? undefined : 'off',
    'data-reduce-transparency': a.reduceTransparency ? 'on' : undefined,
    'data-underline-links': a.underlineLinks ? 'on' : undefined,
    'data-always-focus': a.alwaysVisibleFocusRings ? 'on' : undefined,
    'data-larger-targets': a.largerClickTargets ? 'on' : undefined,
    'data-debug-overlays': a.debugOverlays ? 'on' : undefined,
  };
}

// Free-form values (colors, font names) can't be data-attribute-selector-
// scoped — they're arbitrary strings, not a fixed enum — so they go in as
// literal inline CSS custom-property overrides instead. Empty string means
// "no override," matching every free-form field's own '' default above.
export function appearanceInlineVars(a: Appearance): Record<string, string> {
  const vars: Record<string, string> = {};
  if (a.accent) vars['--th-accent'] = a.accent;
  // --th-glass-tint is consumed inside an rgba(var(--th-glass-tint), alpha)
  // in globals.css, so it needs "r, g, b" component form, not a hex string —
  // a <input type="color"> naturally produces hex, so convert here rather
  // than at the CSS layer (no native hex->rgb function in plain CSS).
  if (a.glassTint) {
    const rgb = hexToRgbTriplet(a.glassTint);
    if (rgb) vars['--th-glass-tint'] = rgb;
  }
  if (a.bodyFont) vars['--th-font-body'] = a.bodyFont;
  if (a.displayFont) vars['--th-font-display'] = a.displayFont;
  if (a.monoFont) vars['--th-font-mono'] = a.monoFont;
  return vars;
}

function hexToRgbTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1]!, 16);
  return `${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}`;
}
