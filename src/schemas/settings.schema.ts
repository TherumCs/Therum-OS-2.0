import { z } from 'zod';

// Appearance is site-wide (one workspace, one look), not per-user — matches
// how a team wants a consistent admin, unlike dashboard card layout below
// which is genuinely a personal preference.
export const AppearanceInput = z.object({
  density: z.enum(['compact', 'comfortable', 'breathing']).optional(),
  sidebarStyle: z.enum(['default', 'pills', 'minimal']).optional(),
  cardStyle: z.enum(['flat', 'shadow', 'glass']).optional(),
  colorMode: z.enum(['light', 'dark', 'system']).optional(),
  contrast: z.enum(['normal', 'high']).optional(),

  accent: z.string().max(20).optional(),
  intensity: z.enum(['subtle', 'normal', 'vivid']).optional(),

  topbarBehavior: z.enum(['default', 'sticky']).optional(),
  contentWidth: z.enum(['full', 'normal', 'narrow']).optional(),
  cardGridGap: z.enum(['compact', 'comfortable', 'spacious']).optional(),

  glassTint: z.string().max(20).optional(),
  blurStrength: z.enum(['light', 'medium', 'heavy']).optional(),
  background: z.enum(['solid', 'subtle-gradient']).optional(),
  shadowStyle: z.enum(['none', 'subtle', 'pronounced']).optional(),

  bodyFont: z.string().max(100).optional(),
  displayFont: z.string().max(100).optional(),
  monoFont: z.string().max(100).optional(),
  baseSize: z.enum(['sm', 'md', 'lg']).optional(),
  letterSpacing: z.enum(['tight', 'normal', 'wide']).optional(),
  lineHeight: z.enum(['compact', 'normal', 'relaxed']).optional(),

  cornerRadius: z.enum(['sharp', 'default', 'round']).optional(),
  borderWeight: z.enum(['thin', 'default', 'thick']).optional(),

  motionEnabled: z.boolean().optional(),
  transitionSpeed: z.enum(['fast', 'default', 'slow']).optional(),
  pageTransitions: z.boolean().optional(),
  hoverLift: z.boolean().optional(),

  cardLayout: z.enum(['compact', 'comfortable']).optional(),
  thumbnailSource: z.enum(['auto', 'cover-only']).optional(),
  listViewDefault: z.enum(['grid', 'table']).optional(),
  itemsPerPage: z.number().int().min(5).max(100).optional(),

  reduceTransparency: z.boolean().optional(),
  underlineLinks: z.boolean().optional(),
  alwaysVisibleFocusRings: z.boolean().optional(),
  largerClickTargets: z.boolean().optional(),

  keyboardShortcuts: z.boolean().optional(),
  debugOverlays: z.boolean().optional(),
});
export type AppearanceInput = z.infer<typeof AppearanceInput>;

// Per-user dashboard card layout — order + size tier, not free-form pixel
// coordinates (see admin/lib/dashboard.ts for why: a size-tier picker + move
// up/down covers the real use case without a drag-and-drop dependency).
export const DashboardLayoutInput = z.object({
  cards: z.array(
    z.object({
      id: z.string().min(1),
      size: z.enum(['xs', 'sm', 'md', 'lg']),
    }),
  ),
});
export type DashboardLayoutInput = z.infer<typeof DashboardLayoutInput>;

// Per-user sidebar section order, custom sections, and per-item section
// assignment — mirrors 1.9.44's therum_sidebar_layout shape exactly (see
// mu-plugins/therum-admin.php's SIDEBAR LAYOUT block). Item ids are the nav
// item's href (stable across loads, the same role `match` plays in 1.9.44).
export const SidebarLayoutInput = z.object({
  sections: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1).max(60),
    }),
  ),
  items: z.record(z.string(), z.array(z.string())),
});
export type SidebarLayoutInput = z.infer<typeof SidebarLayoutInput>;

// Per-user Media library view state — matches 1.9.44's therum_pref_media_
// view_mode / therum_pref_media_density (its slider is 3-7 cols, same range
// here). Both optional: the view toggle saves immediately, the density
// slider debounce-saves separately, so a single request rarely sends both.
export const MediaViewInput = z.object({
  viewMode: z.enum(['grid', 'masonry', 'metro', 'table']).optional(),
  density: z.number().int().min(3).max(7).optional(),
});
export type MediaViewInput = z.infer<typeof MediaViewInput>;

// Quick Controls' per-user Behavior tab — real preferences, distinct from
// the source's fixture-only "Login-screen customization"/"list-page
// defaults" panels (never wired to a save handler there, not ported here).
export const BehaviorInput = z.object({
  loginLandingPage: z.string().max(200).optional(),
  sidebarFolded: z.boolean().optional(),
  listPageRowCount: z.number().int().min(5).max(100).nullable().optional(),
});
export type BehaviorInput = z.infer<typeof BehaviorInput>;

// Quick Controls' per-user Advanced tab — custom CSS. Real sanitization
// happens in me.service.ts (strip @import/expression()/script-bearing
// url()s) — this schema is just the length bound.
export const CustomCssInput = z.object({
  css: z.string().max(20000),
});
export type CustomCssInput = z.infer<typeof CustomCssInput>;

// Import is intentionally a loose object here — the whole point is
// untrusted pasted JSON. Real safety is the service's field allow-list, not
// the shape at this boundary.
export const ImportSettingsInput = z.object({
  appearance: z.record(z.string(), z.unknown()).optional(),
  behavior: z.record(z.string(), z.unknown()).optional(),
});
export type ImportSettingsInput = z.infer<typeof ImportSettingsInput>;

// SEO's site-wide fallback of last resort (site name/description/logo) —
// 1.9.44 doesn't have a settings page for this either (its own file header
// calls it "zero-config"); th_wordmark/th_logo_url actually live under its
// separate, not-yet-ported Customization/Branding system. Minimal fields
// only, data layer only — no dedicated settings-page UI this pass.
export const SeoDefaultsInput = z.object({
  siteName: z.string().max(120).optional(),
  siteDescription: z.string().max(300).optional(),
  siteLogo: z.string().optional(),
});
export type SeoDefaultsInput = z.infer<typeof SeoDefaultsInput>;

// ─── Settings > Admin Dock — mirrors th_dock_position/th_dock_default_mode/
// th_dock_mobile (site-wide options in 1.9.44; the dock itself doesn't exist
// in 2.0 yet — these are the settings the future dock will read). ──────────
export const AdminDockInput = z.object({
  position: z.enum(['bottom', 'top']).optional(),
  defaultMode: z.enum(['scroll', 'always', 'drawer']).optional(),
  mobileStyle: z.enum(['fab', 'none']).optional(),
});
export type AdminDockInput = z.infer<typeof AdminDockInput>;

// ─── Settings > Login — background + copy shown on the sign-in screen. ────
export const LoginBrandingInput = z.object({
  bgType: z.enum(['theme', 'solid', 'image', 'video']).optional(),
  bgColor: z.string().max(20).optional(),
  bgImage: z.string().max(2000).optional(),
  bgVideo: z.string().max(2000).optional(),
  bgOverlay: z.boolean().optional(),
  heading: z.string().max(120).optional(),
  subhead: z.string().max(200).optional(),
  showVersion: z.boolean().optional(),
});
export type LoginBrandingInput = z.infer<typeof LoginBrandingInput>;

// ─── Settings > Performance — every field here saves for real but none is
// load-bearing yet: cache/heartbeat have no backend mechanism to gate (no
// object-cache layer, no polling loop); lazyImages/deferJs/disableEmoji/
// disableEmbeds/minCss/minHtml all describe public-page rendering and 2.0
// has no public theme/renderer yet; revisionsLimit/trashDays/autosaveInterval
// have no matching Content concept (no revisions, no trash, no autosave).
// Kept saveable rather than removed — see performance/page.tsx for the
// per-group user-facing explanation. ─────────────────────────────────────
export const PerformanceInput = z.object({
  cache: z.boolean().optional(),
  lazyImages: z.boolean().optional(),
  deferJs: z.boolean().optional(),
  disableEmoji: z.boolean().optional(),
  disableEmbeds: z.boolean().optional(),
  heartbeat: z.enum(['off', 'slow', 'default']).optional(),
  revisionsLimit: z.number().int().min(0).max(100).optional(),
  trashDays: z.number().int().min(0).max(365).optional(),
  autosaveInterval: z.number().int().min(10).max(3600).optional(),
  minCss: z.boolean().optional(),
  minHtml: z.boolean().optional(),
});
export type PerformanceInput = z.infer<typeof PerformanceInput>;

// ─── Settings > Editor Defaults — 1.9.44's Bricks-vs-Classic distinction
// has no equivalent (2.0 has one unified content builder, not two editors);
// distraction-free is the one preference that still applies as-is. ────────
export const EditorDefaultsInput = z.object({
  distractionFree: z.boolean().optional(),
});
export type EditorDefaultsInput = z.infer<typeof EditorDefaultsInput>;

// ─── Settings > Uploads — per-category toggles, not 1.9.44's 40-checkbox
// per-extension grid: this stack's upload validation checks category groups,
// not individual extensions, so that's the faithful level of granularity. ──
export const UploadsInput = z.object({
  autoRename: z.boolean().optional(),
  maxUploadMb: z.number().int().min(1).max(2048).optional(),
  resizeMaxPx: z.number().int().min(0).max(10000).optional(),
  stripExif: z.boolean().optional(),
  autoWebp: z.boolean().optional(),
  allowImages: z.boolean().optional(),
  allowVideo: z.boolean().optional(),
  allowAudio: z.boolean().optional(),
  allowDocuments: z.boolean().optional(),
  allowArchives: z.boolean().optional(),
  allowCode: z.boolean().optional(),
});
export type UploadsInput = z.infer<typeof UploadsInput>;

// ─── Settings > Notifications. ─────────────────────────────────────────
export const NotificationsInput = z.object({
  adminEmail: z.string().max(200).optional(),
  emailEnabled: z.boolean().optional(),
  smtpHost: z.string().max(255).optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpUser: z.string().max(255).optional(),
  smtpPassword: z.string().max(255).optional(),
  smtpFrom: z.string().max(200).optional(),
  slackWebhook: z.string().max(500).optional(),
  notifyOnLogin: z.boolean().optional(),
  notifyOnUpdate: z.boolean().optional(),
  notifyOnBackup: z.boolean().optional(),
});
export type NotificationsInput = z.infer<typeof NotificationsInput>;

// ─── Settings > Backup — schedule/destination fields are real and saved;
// the actual scheduled-execution engine (cron trigger + pg_dump + S3 upload)
// is flagged as a separate follow-up build, not faked here. ────────────────
// ─── Settings > Redirects ──────────────────────────────────────────────
export const RedirectRuleInput = z.object({
  from: z.string().min(1).max(500),
  to: z.string().min(1).max(2000),
  code: z.number().int().refine((n) => [301, 302, 307, 308, 410].includes(n)).optional(),
  isRegex: z.boolean().optional(),
});
export type RedirectRuleInput = z.infer<typeof RedirectRuleInput>;

export const BackupSettingsInput = z.object({
  enabled: z.boolean().optional(),
  frequency: z.enum(['hourly', 'twicedaily', 'daily', 'weekly']).optional(),
  destination: z.enum(['local', 's3']).optional(),
  s3Bucket: z.string().max(200).optional(),
  s3Region: z.string().max(60).optional(),
  s3AccessKey: z.string().max(200).optional(),
  s3SecretKey: z.string().max(200).optional(),
  s3Endpoint: z.string().max(300).optional(),
  s3Prefix: z.string().max(100).optional(),
});
export type BackupSettingsInput = z.infer<typeof BackupSettingsInput>;

// ─── Settings > Onboarding — progress through the post-setup in-app wizard
// (edition → connections → branding → finish). Pre-auth /login only ever
// handles the account-creation gate itself; this is what happens after,
// while already signed in — skippable and resumable, tracked the same way
// as every other domain here. ────────────────────────────────────────────
export const OnboardingInput = z.object({
  step: z.enum(['edition', 'connections', 'branding', 'finish']).optional(),
  completed: z.boolean().optional(),
});
export type OnboardingInput = z.infer<typeof OnboardingInput>;

// Site identity + Base Theme wiring (public frontend). homepageSlug names the
// published page served at bare / — null falls back to the built-in landing.
export const SiteSettingsInput = z.object({
  siteName: z.string().min(1).max(80).optional(),
  tagline: z.string().max(160).optional(),
  homepageSlug: z.string().max(200).nullable().optional(),
  // Custom nav (ordered). null clears back to auto-built nav.
  menu: z.array(z.object({ label: z.string().min(1).max(60), href: z.string().min(1).max(300) })).max(12).nullable().optional(),
  // WP Bridge chrome override (null = Base Theme chrome)
  chromeHeaderSlug: z.string().max(200).nullable().optional(),
  chromeFooterSlug: z.string().max(200).nullable().optional(),
  chromeCssUrl: z.string().max(500).nullable().optional(),
});
export type SiteSettingsInput = z.infer<typeof SiteSettingsInput>;
