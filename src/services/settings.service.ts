import { isSupported } from '../counter/currency.js';
import { ValidationError } from '../lib/errors.js';
import { Prisma } from '@prisma/client';
import { db } from '../lib/db.js';
import type {
  AppearanceInput,
  AdminDockInput,
  LoginBrandingInput,
  PerformanceInput,
  EditorDefaultsInput,
  UploadsInput,
  NotificationsInput,
  BackupSettingsInput,
  CommerceSettingsInput,
  CounterSettingsInput,
  PaymentsSettingsInput,
  StealthSettingsInput,
  SecuritySettingsInput,
  MaintenanceSettingsInput,
  SeoDefaultsInput,
  OnboardingInput,
} from '../schemas/settings.schema.js';

export interface SeoDefaults {
  siteName: string;
  siteDescription: string;
  siteLogo: string;
}
const SEO_DEFAULTS_KEY = 'seo-defaults';
const SEO_DEFAULTS_DEFAULTS: SeoDefaults = { siteName: '', siteDescription: '', siteLogo: '' };

// Quick Controls (feature-inventory section 05, "Chrome & Customization
// Studio" minus the theme-store/presets half — that's explicitly not this
// pass). One JSON blob, same as the original 5 fields below — a 9th group
// ("Themes": preset shelves + saved-variant CRUD) is deliberately not
// represented here at all, not even as an unused field.
export interface Appearance {
  density: 'compact' | 'comfortable' | 'breathing';
  sidebarStyle: 'default' | 'pills' | 'floating' | 'solid' | 'minimal' | 'dividers';
  cardStyle: 'flat' | 'shadow' | 'glass';
  colorMode: 'light' | 'dark' | 'system';
  contrast: 'normal' | 'high';

  // Appearance
  accent: string; // hex; '' = use the built-in --ac red
  intensity: 'subtle' | 'normal' | 'vivid';

  // Layout
  topbarBehavior: 'default' | 'sticky'; // wires the already-built [data-topbar-style] CSS
  contentWidth: 'full' | 'normal' | 'narrow'; // 'full' = today's real default (uncapped) — a
  // narrower reading width is the opt-in, not the other way, so shipping this can't silently
  // shrink every existing page.
  cardGridGap: 'compact' | 'comfortable' | 'spacious';

  // Surfaces — glass on/off is deliberately NOT a separate field here:
  // that's exactly what cardStyle:'glass' already is (see CHANGELOG).
  glassTint: string; // hex; '' = built-in tint
  blurStrength: 'light' | 'medium' | 'heavy';
  background: 'solid' | 'subtle-gradient';
  shadowStyle: 'none' | 'subtle' | 'pronounced';

  // Typography
  bodyFont: string; // '' = system stack default
  displayFont: string; // '' = Inter Tight default
  monoFont: string; // '' = JetBrains Mono default
  baseSize: 'sm' | 'md' | 'lg';
  letterSpacing: 'tight' | 'normal' | 'wide';
  lineHeight: 'compact' | 'normal' | 'relaxed';

  // Shapes — cardStyle above already covers "card style" itself.
  cornerRadius: 'sharp' | 'default' | 'round';
  borderWeight: 'thin' | 'default' | 'thick';

  // Motion
  motionEnabled: boolean;
  transitionSpeed: 'fast' | 'default' | 'slow';
  pageTransitions: 'off' | 'fade' | 'slide' | 'scale' | 'morph';
  hoverLift: boolean;

  // Content defaults
  cardLayout: 'compact' | 'comfortable';
  thumbnailSource: 'auto' | 'cover-only'; // 'auto' = the SEO engine's existing body-image fallback chain
  listViewDefault: 'grid' | 'table';
  itemsPerPage: number;

  // Accessibility — contrast above already covers normal/high contrast.
  reduceTransparency: boolean;
  underlineLinks: boolean;
  alwaysVisibleFocusRings: boolean;
  largerClickTargets: boolean;

  keyboardShortcuts: boolean;
  debugOverlays: boolean;

  // Ported from 1.9.44's Therum_Themes::default_state() (2026-07-27). The
  // note that used to sit above keyboardShortcuts called grips / autosave /
  // code-editor theme "deliberately NOT fields" — they are now, along with
  // the rest of the 1.9.44 chrome options the Appearance page was missing.
  sidebarLayout: 'both' | 'icons' | 'text';
  sidebarFoldable: boolean;

  glass: boolean;
  /** Mode; `glassTint` above holds the custom colour used when this is 'color'. */
  glassTintMode: 'auto' | 'dark' | 'light' | 'color';
  surfaceEffect: 'none' | 'glass-light' | 'glass-dark' | 'glass-colored' | 'gradient' | 'blurred';
  bgImage: 'none' | 'mesh' | 'grid' | 'noise' | 'dots';

  /** Card TEMPLATE — a different axis from cardLayout (density) and cardStyle (surface). */
  cardTemplate: 'hero' | 'detailed' | 'list-1' | 'list-2' | 'list-3';
  cardImage: 'gradient' | 'featured' | 'stock' | 'wireframe' | 'pattern';

  bentoGap: number;
  autoSave: boolean;
  showGrips: boolean;
  desktopMode: boolean;
  codeEditorTheme: 'therum' | 'github' | 'monokai' | 'solarized' | 'nord';
}

const APPEARANCE_KEY = 'appearance';
const APPEARANCE_DEFAULTS: Appearance = {
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
  pageTransitions: 'morph',
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

  sidebarLayout: 'both',
  sidebarFoldable: false,

  glass: false,
  glassTintMode: 'dark',
  surfaceEffect: 'none',
  bgImage: 'none',

  cardTemplate: 'hero',
  cardImage: 'gradient',

  bentoGap: 16,
  autoSave: true,
  showGrips: false,
  desktopMode: false,
  codeEditorTheme: 'therum',
};

export interface AdminDock {
  position: 'bottom' | 'top';
  defaultMode: 'scroll' | 'always' | 'drawer';
  mobileStyle: 'fab' | 'none';
}
const DOCK_KEY = 'admin-dock';
const DOCK_DEFAULTS: AdminDock = { position: 'bottom', defaultMode: 'scroll', mobileStyle: 'fab' };

export interface LoginBranding {
  bgType: 'theme' | 'solid' | 'image' | 'video';
  bgColor: string;
  bgImage: string;
  bgVideo: string;
  bgOverlay: boolean;
  heading: string;
  subhead: string;
  showVersion: boolean;
}
const LOGIN_KEY = 'login-branding';
const LOGIN_DEFAULTS: LoginBranding = {
  bgType: 'theme',
  bgColor: '#0a0a0a',
  bgImage: '',
  bgVideo: '',
  bgOverlay: true,
  heading: 'Welcome back',
  subhead: 'Sign in to your workspace',
  showVersion: true,
};

// Every field is real and persisted; none is load-bearing yet. See the
// schema comment above PerformanceInput for why, group by group.
export interface Performance {
  cache: boolean;
  lazyImages: boolean;
  deferJs: boolean;
  disableEmoji: boolean;
  disableEmbeds: boolean;
  heartbeat: 'off' | 'slow' | 'default';
  revisionsLimit: number;
  trashDays: number;
  autosaveInterval: number;
  minCss: boolean;
  minHtml: boolean;
}
const PERFORMANCE_KEY = 'performance';
const PERFORMANCE_DEFAULTS: Performance = {
  cache: true,
  lazyImages: true,
  deferJs: false,
  disableEmoji: true,
  disableEmbeds: true,
  heartbeat: 'slow',
  revisionsLimit: 5,
  trashDays: 7,
  autosaveInterval: 120,
  minCss: false,
  minHtml: false,
};

export interface EditorDefaults {
  distractionFree: boolean;
}
const EDITOR_KEY = 'editor-defaults';
const EDITOR_DEFAULTS: EditorDefaults = { distractionFree: false };

export interface Uploads {
  autoRename: boolean;
  maxUploadMb: number;
  resizeMaxPx: number;
  stripExif: boolean;
  autoWebp: boolean;
  allowImages: boolean;
  allowVideo: boolean;
  allowAudio: boolean;
  allowDocuments: boolean;
  allowArchives: boolean;
  allowCode: boolean;
}
export interface Commerce {
  currency: string;
  locale: string | null;
  /** Minimum margin over cost that any discount must leave. 0 = no floor. */
  minMarginPct: number;
}

/** Counter's own storefront presentation — see CounterSettingsInput. */
export interface CounterSettings {
  cartStyle: 'mini' | 'sidebar';
  cartSidebarReveal: 'overlay' | 'push';
  cartSidebarGround: string;
  cardShell: 'bare' | 'boxed' | 'elevated';
  cardMedia: 'still' | 'fade' | 'gallery' | 'motion';
  cardMediaSecondary: 'still' | 'fade' | 'gallery' | 'motion';
  cardPreset: 'editorial' | 'retail' | 'detailed' | 'sneaker' | 'data';
  cardAction: 'none' | 'below' | 'overlay' | 'dual' | 'icons';
  cardEvolve: boolean;
  cardAlign: 'start' | 'center' | 'end';
  cardRadius: 'sharp' | 'soft' | 'round' | 'pill' | 'squircle';
  cardRatio: 'square' | 'portrait' | 'tall' | 'landscape' | 'natural';
  cardFit: 'cover' | 'contain';
  cardShadow: 'none' | 'soft' | 'strong';
  cardHover: 'none' | 'lift' | 'zoom' | 'both';
  cardGap: 'tight' | 'normal' | 'roomy';
  cardReveal: 'none' | 'fade' | 'rise' | 'stagger';
  cardSubtitle: boolean;
  cardBadges: boolean;
  memberPricing: 'off' | 'net' | 'was-now';
  memberPriceLabel: string;
  contactTopics: { id: string; label: string; email: string; fields: string[]; blurb?: string }[];
  toolbarEnabled: boolean;
  toolbarStyle: 'bar' | 'minimal';
  toolbarSearch: boolean;
  toolbarFilters: boolean;
  toolbarSort: boolean;
  toolbarView: boolean;
  toolbarCount: boolean;
  toolbarColumns: number;
  toolbarPageSize: number;
  toolbarSearchPlaceholder: string;
  toolbarFilterFields: ('category' | 'tags' | 'color' | 'size' | 'brand' | 'price' | 'availability')[];
  toolbarSorts: ('new' | 'oldest' | 'name' | 'name-desc' | 'price-asc' | 'price-desc' | 'best-selling')[];
  toolbarDefaultSort: 'new' | 'oldest' | 'name' | 'name-desc' | 'price-asc' | 'price-desc' | 'best-selling';
  searchStyle: 'takeover' | 'inline' | 'immersive';
  wishlistEnabled: boolean;
  wishlistOnCards: boolean;
}
export interface Payments {
  stripePublishableKey: string;
  squareApplicationId: string;
  environment: 'live' | 'sandbox';
  appleDomainAssociation: string;
}
export interface Stealth {
  hidePlatformCredit: boolean;
  hideVersion: boolean;
  adminKnock: string;
}
const STEALTH_KEY = 'stealth';
const SECURITY_KEY = 'security';
const MAINTENANCE_KEY = 'maintenance';
const STEALTH_DEFAULTS: Stealth = { hidePlatformCredit: false, hideVersion: false, adminKnock: '' };

export interface Security {
  requireTwoFactor: boolean;
}
// Off by default. Turning it on is a deliberate act with a real consequence
// for every existing account, so it must never arrive by upgrade.
const SECURITY_DEFAULTS: Security = { requireTwoFactor: false };

export interface Maintenance {
  mode: 'off' | 'maintenance' | 'coming-soon';
  heading: string;
  message: string;
  buttonLabel: string;
  buttonHref: string;
  backgroundImage: string;
  retryAfterMinutes: number;
}
const MAINTENANCE_DEFAULTS: Maintenance = {
  mode: 'off',
  heading: 'We will be back shortly',
  message: 'The site is down for scheduled maintenance. Thanks for your patience.',
  buttonLabel: '',
  buttonHref: '',
  backgroundImage: '',
  retryAfterMinutes: 60,
};
// Consulted on EVERY public request, so it is cached like the security flag —
// an uncached settings read here is one extra query per page view forever.
let maintenanceCache: { value: Maintenance; at: number } | null = null;

let securityCache: { value: Security; at: number } | null = null;
const SECURITY_CACHE_MS = 15_000;

const PAYMENTS_KEY = 'payments';
const PAYMENTS_DEFAULTS: Payments = {
  stripePublishableKey: '',
  squareApplicationId: '',
  environment: 'live',
  appleDomainAssociation: '',
};

const COMMERCE_KEY = 'commerce';
// Off by default: a store that has not recorded costs would otherwise have
// every discount silently clamped by a number it never set.
const COMMERCE_DEFAULTS: Commerce = { currency: 'USD', locale: null, minMarginPct: 0 };

const COUNTER_KEY = 'counter';
const COUNTER_DEFAULTS: CounterSettings = {
  // Sidebar + push: the ported header already ships `c-header__cart--sidebar`
  // and a `js-cart-sidebar-open` hook, so that is the presentation this site's
  // markup was built for, and push is what Bam asked the drawer to do.
  cartStyle: 'sidebar',
  cartSidebarReveal: 'push',
  cartSidebarGround: '#0a0a0a',
  // Bare + editorial: the reference Bam led with, and the one that cannot look
  // wrong on a store whose products have no ratings, sizes or was-prices yet.
  cardShell: 'bare',
  cardPreset: 'editorial',
  // 'fade' rather than 'gallery' or 'motion': it is the one behaviour that
  // cannot fail — every product has a second image far more often than it has
  // a video, and a cross-fade has nothing to click.
  cardMedia: 'fade',
  // Still, because it is the one behaviour EVERY product can support — a
  // fallback that can itself fall back is not a fallback.
  cardMediaSecondary: 'still',
  // Not 'overlay'. A button floating on the product covers the thing the
  // shopper is looking at, and it was the first thing Bam called out.
  cardAction: 'none',
  // On by default the moment a card HAS an add-to-cart: sending someone to a
  // product page to pick a size they could have picked here is the friction
  // the whole card was built to remove.
  cardEvolve: true,
  cardAlign: 'start',
  cardRadius: 'sharp',
  cardRatio: 'square',
  cardFit: 'cover',
  cardShadow: 'soft',
  cardHover: 'none',
  cardGap: 'normal',
  cardReveal: 'none',
  cardSubtitle: true,
  cardBadges: true,
  memberPricing: 'net',
  memberPriceLabel: 'Your price',
  // Real routing, from the mailbox list Bam supplied.
  //
  // General / My order / Returns map to purpose-built inboxes. Modelling,
  // Press, Partnerships and Careers have NO matching address on that list, so
  // they land on info@ — the general-inquiries box — rather than being pointed
  // at a named person's inbox (bam@, bryant@, mira@) on my own judgement, or
  // at an alias that does not exist yet. Give each one its own address and
  // this is a settings change.
  contactTopics: [
    { id: 'general', label: 'General', email: 'info@sidemoney.co', fields: [], blurb: 'Anything that does not fit the others.' },
    { id: 'order', label: 'My order', email: 'orders@sidemoney.co', fields: ['order'], blurb: 'Where it is, changing it, something wrong with it.' },
    { id: 'returns', label: 'Returns', email: 'support@sidemoney.co', fields: ['order'], blurb: 'Sending something back or exchanging it.' },
    { id: 'modelling', label: 'Modelling', email: 'info@sidemoney.co', fields: ['instagram', 'portfolio'], blurb: 'Casting and test shoots.' },
    { id: 'press', label: 'Press', email: 'info@sidemoney.co', fields: ['company'], blurb: 'Interviews, samples, features.' },
    { id: 'partnerships', label: 'Partnerships', email: 'info@sidemoney.co', fields: ['company', 'budget'], blurb: 'Collaborations, wholesale, brand work.' },
    { id: 'careers', label: 'Careers', email: 'info@sidemoney.co', fields: ['portfolio', 'instagram'], blurb: 'Applying for something on the careers page.' },
  ],
  toolbarEnabled: true,
  toolbarStyle: 'bar',
  toolbarSearch: true,
  toolbarFilters: true,
  toolbarSort: true,
  toolbarView: true,
  toolbarCount: true,
  toolbarColumns: 4,
  toolbarPageSize: 24,
  toolbarSearchPlaceholder: '',
  toolbarFilterFields: ['category', 'tags', 'color', 'size'],
  toolbarSorts: ['new', 'name', 'price-asc', 'price-desc'],
  toolbarDefaultSort: 'new',
  searchStyle: 'takeover',
  wishlistEnabled: true,
  wishlistOnCards: true,
};

const UPLOADS_KEY = 'uploads';
const UPLOADS_DEFAULTS: Uploads = {
  autoRename: false,
  maxUploadMb: 64,
  resizeMaxPx: 2560,
  stripExif: true,
  autoWebp: false,
  allowImages: true,
  allowVideo: true,
  allowAudio: true,
  allowDocuments: true,
  allowArchives: false,
  allowCode: false,
};

export interface Notifications {
  adminEmail: string;
  emailEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
  slackWebhook: string;
  notifyOnLogin: boolean;
  notifyOnUpdate: boolean;
  notifyOnBackup: boolean;
}
const NOTIFICATIONS_KEY = 'notifications';
const NOTIFICATIONS_DEFAULTS: Notifications = {
  adminEmail: '',
  emailEnabled: true,
  smtpHost: '',
  smtpPort: 587,
  smtpUser: '',
  smtpPassword: '',
  smtpFrom: '',
  slackWebhook: '',
  notifyOnLogin: false,
  notifyOnUpdate: true,
  notifyOnBackup: false,
};

// The post-setup in-app wizard's own progress — separate from anything
// pre-auth. `step` is where /onboarding resumes to; `completed` is what the
// dashboard checks to decide whether to show the "finish setup" banner at
// all (true whether the user actually finished or explicitly skipped).
export interface Onboarding {
  step: 'account' | 'edition' | 'addons' | 'configure' | 'branding' | 'finish' | 'store' | 'connections';
  completed: boolean;
}
const ONBOARDING_KEY = 'onboarding';
const ONBOARDING_DEFAULTS: Onboarding = { step: 'account', completed: false };

export interface BackupSettings {
  enabled: boolean;
  frequency: 'hourly' | 'twicedaily' | 'daily' | 'weekly';
  destination: 'local' | 's3';
  s3Bucket: string;
  s3Region: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3Endpoint: string;
  s3Prefix: string;
}
const BACKUP_KEY = 'backup';
const BACKUP_DEFAULTS: BackupSettings = {
  enabled: false,
  frequency: 'daily',
  destination: 'local',
  s3Bucket: '',
  s3Region: 'us-east-1',
  s3AccessKey: '',
  s3SecretKey: '',
  s3Endpoint: '',
  s3Prefix: 'therum-backups',
};

// Generic read/write over the key-value store — every typed settings domain
// (appearance now; login branding, notifications, backup, etc. as later
// workstreams land) is a thin wrapper over these two functions, same as
// 1.9.44's TH_SETTINGS_KEYS-gated generic option-save, minus the WP-options
// autoload/whitelist machinery (Postgres just indexes on the key).
async function read<T>(key: string, fallback: T): Promise<T> {
  const row = await db.setting.findUnique({ where: { key } });
  if (!row) return fallback;
  return { ...fallback, ...(row.value as object) } as T;
}

async function write(key: string, value: object): Promise<void> {
  await db.setting.upsert({
    where: { key },
    update: { value: value as Prisma.InputJsonValue },
    create: { key, value: value as Prisma.InputJsonValue },
  });
}

export interface SiteSettings {
  siteName: string;
  tagline: string;
  homepageSlug: string | null;
  // Custom nav menu (Base Theme). null = auto-build from published content.
  menu: { label: string; href: string }[] | null;
  // Site chrome override (WP Bridge): published content slugs rendered as the
  // public header/footer instead of the Base Theme defaults, plus the ported
  // theme stylesheet (a media-library asset) that styles them. All null =
  // Base Theme chrome as before.
  chromeHeaderSlug: string | null;
  chromeFooterSlug: string | null;
  chromeCssUrl: string | null;
  showPageTitles: boolean;
}
const SITE_KEY = 'site';
const SITE_DEFAULTS: SiteSettings = { siteName: 'Therum Site', tagline: '', homepageSlug: null, menu: null, chromeHeaderSlug: null, chromeFooterSlug: null, chromeCssUrl: null, showPageTitles: true };

export const settingsService = {
  // Site identity + Base Theme wiring (public frontend, C-site).
  async getSite(): Promise<SiteSettings> {
    return read(SITE_KEY, SITE_DEFAULTS);
  },
  async setSite(input: Partial<SiteSettings>): Promise<SiteSettings> {
    const next = { ...(await this.getSite()), ...input };
    await write(SITE_KEY, next);
    return next;
  },

  async getAppearance(): Promise<Appearance> {
    return read(APPEARANCE_KEY, APPEARANCE_DEFAULTS);
  },

  async setAppearance(input: AppearanceInput): Promise<Appearance> {
    const current = await this.getAppearance();
    const next = { ...current, ...input };
    await write(APPEARANCE_KEY, next);
    return next;
  },

  async getAdminDock(): Promise<AdminDock> {
    return read(DOCK_KEY, DOCK_DEFAULTS);
  },
  async setAdminDock(input: AdminDockInput): Promise<AdminDock> {
    const next = { ...(await this.getAdminDock()), ...input };
    await write(DOCK_KEY, next);
    return next;
  },

  async getLoginBranding(): Promise<LoginBranding> {
    return read(LOGIN_KEY, LOGIN_DEFAULTS);
  },
  async setLoginBranding(input: LoginBrandingInput): Promise<LoginBranding> {
    const next = { ...(await this.getLoginBranding()), ...input };
    await write(LOGIN_KEY, next);
    return next;
  },

  async getPerformance(): Promise<Performance> {
    return read(PERFORMANCE_KEY, PERFORMANCE_DEFAULTS);
  },
  async setPerformance(input: PerformanceInput): Promise<Performance> {
    const next = { ...(await this.getPerformance()), ...input };
    await write(PERFORMANCE_KEY, next);
    return next;
  },

  async getEditorDefaults(): Promise<EditorDefaults> {
    return read(EDITOR_KEY, EDITOR_DEFAULTS);
  },
  async setEditorDefaults(input: EditorDefaultsInput): Promise<EditorDefaults> {
    const next = { ...(await this.getEditorDefaults()), ...input };
    await write(EDITOR_KEY, next);
    return next;
  },

  // ─── Counter: store currency ─────────────────────────────────────────────
  async getCommerce(): Promise<Commerce> {
    return read(COMMERCE_KEY, COMMERCE_DEFAULTS);
  },
  async setCommerce(input: CommerceSettingsInput): Promise<Commerce> {
    // Reject an unsupported code here rather than at checkout — a store whose
    // currency setting is nonsense should fail while someone is looking at it.
    if (input.currency && !isSupported(input.currency)) {
      throw new ValidationError(`${input.currency} is not a currency this store supports.`, 'currency');
    }
    const next = { ...(await this.getCommerce()), ...input };
    if (next.currency) next.currency = next.currency.toUpperCase();
    await write(COMMERCE_KEY, next);
    return next;
  },

  // ─── Counter: storefront presentation ────────────────────────────────────
  async getCounter(): Promise<CounterSettings> {
    const stored = await read(COUNTER_KEY, COUNTER_DEFAULTS);
    // 'evolve' used to be a cardAction of its own. It is a MODIFIER now — any
    // add-to-cart can flip into a picker — so a stored 'evolve' maps to the
    // two-button card it actually was, with the modifier on. Read-time rather
    // than a migration: settings are one JSON blob, so the alternative is a
    // one-off script that has to be remembered for every install.
    const action = stored.cardAction as string;
    if (action === 'evolve') {
      return { ...stored, cardAction: 'dual', cardEvolve: true };
    }
    return stored;
  },
  async setCounter(input: CounterSettingsInput): Promise<CounterSettings> {
    const next = { ...(await this.getCounter()), ...input };
    await write(COUNTER_KEY, next);
    return next;
  },

  async getStealth(): Promise<Stealth> {
    return read(STEALTH_KEY, STEALTH_DEFAULTS);
  },
  async setStealth(input: StealthSettingsInput): Promise<Stealth> {
    const next = { ...(await this.getStealth()), ...input };
    await write(STEALTH_KEY, next);
    return next;
  },

  async getMaintenance(): Promise<Maintenance> {
    return read(MAINTENANCE_KEY, MAINTENANCE_DEFAULTS);
  },
  async getMaintenanceCached(): Promise<Maintenance> {
    if (maintenanceCache && Date.now() - maintenanceCache.at < SECURITY_CACHE_MS) return maintenanceCache.value;
    const value = await read(MAINTENANCE_KEY, MAINTENANCE_DEFAULTS);
    maintenanceCache = { value, at: Date.now() };
    return value;
  },
  async setMaintenance(input: MaintenanceSettingsInput): Promise<Maintenance> {
    const next = { ...(await this.getMaintenance()), ...input };
    await write(MAINTENANCE_KEY, next);
    // Cleared on write so switching the site back ON is instant. Waiting out a
    // TTL while the site shows a maintenance page is the exact moment nobody
    // has patience for.
    maintenanceCache = null;
    return next;
  },

  async getSecurity(): Promise<Security> {
    return read(SECURITY_KEY, SECURITY_DEFAULTS);
  },
  /**
   * Cached read for the auth middleware, which consults this on EVERY
   * authenticated request — an uncached settings row there is one extra query
   * per request forever, for a value that changes perhaps twice in an
   * install's life. The cache is cleared on write, so a deliberate change
   * still takes effect on the very next request; the TTL only bounds staleness
   * if another process does the writing.
   */
  async getSecurityCached(): Promise<Security> {
    if (securityCache && Date.now() - securityCache.at < SECURITY_CACHE_MS) return securityCache.value;
    const value = await read(SECURITY_KEY, SECURITY_DEFAULTS);
    securityCache = { value, at: Date.now() };
    return value;
  },
  async setSecurity(input: SecuritySettingsInput): Promise<Security> {
    const next = { ...(await this.getSecurity()), ...input };
    await write(SECURITY_KEY, next);
    securityCache = null;
    return next;
  },

  async getPayments(): Promise<Payments> {
    return read(PAYMENTS_KEY, PAYMENTS_DEFAULTS);
  },
  async setPayments(input: PaymentsSettingsInput): Promise<Payments> {
    const next = { ...(await this.getPayments()), ...input };
    await write(PAYMENTS_KEY, next);
    return next;
  },

  async getUploads(): Promise<Uploads> {
    return read(UPLOADS_KEY, UPLOADS_DEFAULTS);
  },
  async setUploads(input: UploadsInput): Promise<Uploads> {
    const next = { ...(await this.getUploads()), ...input };
    await write(UPLOADS_KEY, next);
    return next;
  },

  async getNotifications(): Promise<Notifications> {
    return read(NOTIFICATIONS_KEY, NOTIFICATIONS_DEFAULTS);
  },
  async setNotifications(input: NotificationsInput): Promise<Notifications> {
    const next = { ...(await this.getNotifications()), ...input };
    await write(NOTIFICATIONS_KEY, next);
    return next;
  },

  async getBackupSettings(): Promise<BackupSettings> {
    return read(BACKUP_KEY, BACKUP_DEFAULTS);
  },
  async setBackupSettings(input: BackupSettingsInput): Promise<BackupSettings> {
    const next = { ...(await this.getBackupSettings()), ...input };
    await write(BACKUP_KEY, next);
    return next;
  },

  async getSeoDefaults(): Promise<SeoDefaults> {
    return read(SEO_DEFAULTS_KEY, SEO_DEFAULTS_DEFAULTS);
  },
  async setSeoDefaults(input: SeoDefaultsInput): Promise<SeoDefaults> {
    const current = await this.getSeoDefaults();
    const next = { ...current, ...input };
    await write(SEO_DEFAULTS_KEY, next);
    return next;
  },

  async getOnboarding(): Promise<Onboarding> {
    return read(ONBOARDING_KEY, ONBOARDING_DEFAULTS);
  },
  async setOnboarding(input: OnboardingInput): Promise<Onboarding> {
    const next = { ...(await this.getOnboarding()), ...input };
    await write(ONBOARDING_KEY, next);
    return next;
  },
};
