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
  sidebarStyle: 'default' | 'pills' | 'minimal';
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
  pageTransitions: boolean;
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

  // Advanced — grip handles / autosave-toggle / code-editor theme are
  // deliberately NOT fields here; see CHANGELOG for why each is N/A.
  keyboardShortcuts: boolean;
  debugOverlays: boolean;
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
  step: 'edition' | 'connections' | 'branding' | 'finish';
  completed: boolean;
}
const ONBOARDING_KEY = 'onboarding';
const ONBOARDING_DEFAULTS: Onboarding = { step: 'edition', completed: false };

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
}
const SITE_KEY = 'site';
const SITE_DEFAULTS: SiteSettings = { siteName: 'Therum Site', tagline: '', homepageSlug: null, menu: null, chromeHeaderSlug: null, chromeFooterSlug: null, chromeCssUrl: null };

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
