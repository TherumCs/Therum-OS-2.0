import { isSupported } from '../counter/currency.js';
import { ValidationError } from '../lib/errors.js';
import { Prisma } from '@prisma/client';
import { db } from '../lib/db.js';
import { cached, invalidate, forgetCacheEnabled } from '../lib/cache.js';
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
  sidebarHighlight: 'band' | 'indicator' | 'underline';
  cardStyle: 'flat' | 'shadow';
  colorMode: 'light' | 'dark' | 'system';
  contrast: 'normal' | 'high';

  // Appearance
  accent: string; // hex; '' = use the built-in --ac red
  intensity: 'subtle' | 'normal' | 'vivid';

  // Layout
  topbarBehavior: 'default' | 'sticky'; // wires the already-built [data-topbar-style] CSS
  contentWidth: 'expanded' | 'full' | 'normal' | 'narrow'; // 'full' = today's real default (uncapped) — a
  // narrower reading width is the opt-in, not the other way, so shipping this can't silently
  // shrink every existing page.
  cardGridGap: 'compact' | 'comfortable' | 'spacious';

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

  bgImage: 'none' | 'mesh' | 'grid' | 'noise' | 'dots';

  /** Card TEMPLATE — a different axis from cardLayout (density) and cardStyle (surface). */
  cardTemplate: 'hero' | 'detailed' | 'list-1' | 'list-2' | 'list-3';
  cardImage: 'gradient' | 'featured' | 'stock' | 'wireframe' | 'pattern';

  bentoGap: number;
  showGrips: boolean;
  desktopMode: boolean;
  codeEditorTheme: 'therum' | 'github' | 'monokai' | 'solarized' | 'nord';
}

const APPEARANCE_KEY = 'appearance';
const APPEARANCE_DEFAULTS: Appearance = {
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

export interface AdminDock {
  position: 'bottom' | 'top';
  defaultMode: 'scroll' | 'always' | 'drawer';
  mobileStyle: 'fab' | 'none';
  /** Visual skin of the admin lens. */
  style: 'bar' | 'large' | 'dock';
}
const DOCK_KEY = 'admin-dock';
const DOCK_DEFAULTS: AdminDock = { position: 'bottom', defaultMode: 'scroll', mobileStyle: 'fab', style: 'bar' };

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
  /** Offered when no connected provider quotes real rates. */
  shippingMethods: { id: string; name: string; detail: string; prices: Record<string, number>; freeOver: number | null; enabled: boolean }[];
  shippingZones: { id: string; name: string; states: string[]; isRest: boolean }[];
  pickup: { enabled: boolean; price: number; address: string; note: string; slots?: { id: string; name: string; detail: string }[] };
  /** Subtotal (minor units) at or above which Standard ships free. 0 = off. */
  freeShippingOver: number;
  /** Flat tax percent applied when no provider quotes tax. 0 = none. */
  taxRatePct: number;
  cartStyle: 'mini' | 'sidebar';
  cartSidebarReveal: 'overlay' | 'push';
  cartMobile: 'drawer' | 'page';
  cartSidebarGround: string;
  cardShell: 'bare' | 'boxed' | 'elevated';
  cardMedia: 'auto' | 'still' | 'fade' | 'gallery' | 'motion';
  cardMediaSecondary: 'auto' | 'still' | 'fade' | 'gallery' | 'motion';
  cardPreset: 'editorial' | 'retail' | 'detailed' | 'sneaker' | 'data';
  /**
   * PRODUCT PAGE layout. Separate from cardPreset, which styles the grid.
   *
   *   classic   — what the store has shipped: gallery left, details right.
   *   apple     — one large centred image, generous space, tight type.
   *   athletic  — full-bleed image row with the details floating over it.
   *   editorial — oversized wordmark, overlapping hero, price in the button.
   */
  pdpStyle: 'classic' | 'apple' | 'athletic' | 'editorial';
  /** Corner radius on storefront buttons (Add to cart, checkout, everywhere). */
  buttonShape: 'sharp' | 'soft' | 'round' | 'pill';
  /** Which side the imagery sits on. Ignored by styles that are centred or full-bleed. */
  pdpImageSide: 'left' | 'right';
  /** Where the thumbnail strip goes. */
  pdpThumbs: 'bottom' | 'side' | 'none';
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
  searchStyle: 'takeover' | 'inline' | 'fullwidth' | 'immersive';
  /** How results are laid out inside whichever search style is on. */
  searchLayout: 'list' | 'grid' | 'categories' | 'slider';
  wishlistEnabled: boolean;
  wishlistOnCards: boolean;
}
export interface Payments {
  stripePublishableKey: string;
  squareApplicationId: string;
  /** Which Stripe method configuration to pin — see the schema for why. */
  stripePaymentMethodConfiguration: string;
  environment: 'live' | 'sandbox';
  appleDomainAssociation: string;
  /** Route cards/wallets/Stripe-BNPL to 'stripe' (direct) or 'woopay' (engine). */
  cardProvider: 'stripe' | 'woopay';
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
  /** Full-bleed background video for the coming-soon page. */
  backgroundVideo: string;
  /**
   * Shown while the video loads and to anyone who will never get it: iOS Low
   * Power Mode refuses autoplay outright, and prefers-reduced-motion should
   * not be overridden for a decorative loop. Falls back to backgroundImage.
   */
  videoPoster: string;
  /** ISO timestamp the countdown runs to. Empty hides the countdown. */
  countdownTo: string;
  /** Label above the digits — "Doors open in". */
  countdownLabel: string;
  /** Handle without the @. Empty hides the link. */
  instagram: string;
  /** Collect addresses on the coming-soon page. */
  emailCapture: boolean;
  emailPlaceholder: string;
  emailButtonLabel: string;
  emailThanks: string;
}
const MAINTENANCE_DEFAULTS: Maintenance = {
  mode: 'off',
  backgroundVideo: '',
  videoPoster: '',
  countdownTo: '',
  countdownLabel: 'Doors open in',
  instagram: '',
  emailCapture: true,
  emailPlaceholder: 'Your email',
  emailButtonLabel: 'Notify me',
  emailThanks: "You're on the list.",
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
  stripePaymentMethodConfiguration: '',
  environment: 'live',
  appleDomainAssociation: '',
  cardProvider: 'stripe',
};

const COMMERCE_KEY = 'commerce';
// Off by default: a store that has not recorded costs would otherwise have
// every discount silently clamped by a number it never set.
const COMMERCE_DEFAULTS: Commerce = { currency: 'USD', locale: null, minMarginPct: 0 };

const COUNTER_KEY = 'counter';
const COUNTER_DEFAULTS: CounterSettings = {
  // Matches the checkout preview (previews/checkout-experience.html) so a new
  // store can sell on day one. A connected provider overrides these entirely.
  shippingMethods: [
    { id: 'standard', name: 'Standard', detail: '5–7 business days', prices: { rest: 0 }, freeOver: null, enabled: true },
    { id: 'express', name: 'Express', detail: '2–3 business days', prices: { rest: 999 }, freeOver: null, enabled: true },
    { id: 'overnight', name: 'Overnight', detail: 'Next business day', prices: { rest: 2499 }, freeOver: null, enabled: true },
  ],
  shippingZones: [{ id: 'rest', name: 'Rest of US', states: [], isRest: true }],
  pickup: { enabled: false, price: 0, address: '', note: '' },
  freeShippingOver: 0,
  taxRatePct: 0,
  // Sidebar + push: the ported header already ships `c-header__cart--sidebar`
  // and a `js-cart-sidebar-open` hook, so that is the presentation this site's
  // markup was built for, and push is what Bam asked the drawer to do.
  cartStyle: 'sidebar',
  cartSidebarReveal: 'push',
  cartMobile: 'drawer',
  cartSidebarGround: '#0a0a0a',
  // Bare + editorial: the reference Bam led with, and the one that cannot look
  // wrong on a store whose products have no ratings, sizes or was-prices yet.
  cardShell: 'bare',
  cardPreset: 'editorial',
  pdpStyle: 'classic',
  buttonShape: 'sharp',
  pdpImageSide: 'left',
  pdpThumbs: 'bottom',
  // 'auto', so a product carrying a video renders as a motion card and one
  // with several photos gets arrows, without anyone visiting Settings. A hard
  // default here silently capped every card at that behaviour: 'fade' meant
  // videos never played, because fade is supported by anything with 2 images.
  cardMedia: 'auto',
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
  // The TOPICS ship as product defaults; the ADDRESSES do not.
  //
  // Every email is intentionally empty. A default address belonging to whoever
  // the software was first built for would silently route a new store's
  // customer mail to a stranger — and it would look like it was working. An
  // empty address is visibly unconfigured, which is the correct state for a
  // fresh install.
  //
  // Local part conventions are suggested in the label copy (info@, orders@,
  // support@) so an operator knows what each topic expects.
  contactTopics: [
    { id: 'general', label: 'General', email: '', fields: [], blurb: 'Anything that does not fit the others.' },
    { id: 'order', label: 'My order', email: '', fields: ['order'], blurb: 'Where it is, changing it, something wrong with it.' },
    { id: 'returns', label: 'Returns', email: '', fields: ['order'], blurb: 'Sending something back or exchanging it.' },
    { id: 'modelling', label: 'Modelling', email: '', fields: ['instagram', 'portfolio'], blurb: 'Casting and test shoots.' },
    { id: 'press', label: 'Press', email: '', fields: ['company'], blurb: 'Interviews, samples, features.' },
    { id: 'partnerships', label: 'Partnerships', email: '', fields: ['company', 'budget'], blurb: 'Collaborations, wholesale, brand work.' },
    { id: 'careers', label: 'Careers', email: '', fields: ['portfolio', 'instagram'], blurb: 'Applying for something on the careers page.' },
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
  searchLayout: 'grid',
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
// autoload/allowlist machinery (Postgres just indexes on the key).
/**
 * Read a settings row, through the shared cache.
 *
 * Every getter in this file goes through here, so caching once covers all
 * seventeen of them. Settings are read on effectively every request — the site
 * name, the counter config, the SEO defaults — and change only when a human
 * saves the form, which is the shape a cache is actually for.
 *
 * The fallback merge stays OUTSIDE the cached value: what gets stored is the
 * stored row, so adding a field to a defaults object takes effect immediately
 * rather than after the TTL of every cached entry.
 */
async function read<T>(key: string, fallback: T): Promise<T> {
  const stored = await cached('settings', key, async () => {
    const row = await db.setting.findUnique({ where: { key } });
    return (row?.value ?? null) as object | null;
  });
  if (!stored) return fallback;
  return { ...fallback, ...stored } as T;
}

async function write(key: string, value: object): Promise<void> {
  await db.setting.upsert({
    where: { key },
    update: { value: value as Prisma.InputJsonValue },
    create: { key, value: value as Prisma.InputJsonValue },
  });
  // Invalidated on the way out, not on a timer: a merchant who saves a setting
  // and reloads must see the change, and "wait sixty seconds" is not an answer
  // anyone accepts about their own admin panel.
  await invalidate('settings');
  maintenanceCache = null;
  securityCache = null;
  // Turning the cache off in Settings > Performance must take effect on the
  // next request, not after this process's own 5s memo expires.
  forgetCacheEnabled();
}

export interface SiteSettings {
  /** Storefront content column width. See SiteSettingsInput. */
  contentWidth: 'narrow' | 'normal' | 'wide' | 'full';
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
const SITE_DEFAULTS: SiteSettings = { contentWidth: 'wide', siteName: 'Therum Site', tagline: '', homepageSlug: null, menu: null, chromeHeaderSlug: null, chromeFooterSlug: null, chromeCssUrl: null, showPageTitles: true };

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
    // Projected onto the known key set, not a plain merge. `read` spreads the
    // stored row over the defaults, so every key ever written survives
    // forever — a field removed from the product (glass, autoSave) kept being
    // served from the old row and kept appearing in the API response after
    // its code was gone. Anything not in APPEARANCE_DEFAULTS is no longer a
    // setting, so it does not come back.
    const stored = await read(APPEARANCE_KEY, APPEARANCE_DEFAULTS);
    const out = {} as Appearance;
    for (const key of Object.keys(APPEARANCE_DEFAULTS) as (keyof Appearance)[]) {
      out[key] = stored[key] as never;
    }
    return out;
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
