import { z } from 'zod';

// Appearance is site-wide (one workspace, one look), not per-user — matches
// how a team wants a consistent admin, unlike dashboard card layout below
// which is genuinely a personal preference.
export const AppearanceInput = z.object({
  density: z.enum(['compact', 'comfortable', 'breathing']).optional(),
  sidebarStyle: z.enum(['default', 'pills', 'floating', 'solid', 'minimal', 'dividers']).optional(),
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

  // ── Ported from 1.9.44's Therum_Themes::default_state() (2026-07-27) ────
  // These existed in the 1.9.44 chrome but had no field here, so the Appearance
  // page could not offer them. Option lists are 1.9.44's exact sets, not
  // approximations — see therum-settings.php's own radio groups.

  sidebarLayout: z.enum(['both', 'icons', 'text']).optional(),
  sidebarFoldable: z.boolean().optional(),

  glass: z.boolean().optional(),
  // The MODE, distinct from `glassTint` above which stores the custom colour
  // used when this is 'color'.
  glassTintMode: z.enum(['auto', 'dark', 'light', 'color']).optional(),
  surfaceEffect: z.enum(['none', 'glass-light', 'glass-dark', 'glass-colored', 'gradient', 'blurred']).optional(),
  bgImage: z.enum(['none', 'mesh', 'grid', 'noise', 'dots']).optional(),

  // 1.9.44's card TEMPLATE, a different axis from `cardLayout` (which is only
  // density) and `cardStyle` (which is only surface treatment).
  cardTemplate: z.enum(['hero', 'detailed', 'list-1', 'list-2', 'list-3']).optional(),
  cardImage: z.enum(['gradient', 'featured', 'stock', 'wireframe', 'pattern']).optional(),

  bentoGap: z.number().int().min(0).max(48).optional(),
  autoSave: z.boolean().optional(),
  showGrips: z.boolean().optional(),
  desktopMode: z.boolean().optional(),
  codeEditorTheme: z.enum(['therum', 'github', 'monokai', 'solarized', 'nord']).optional(),
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
  viewMode: z.enum(['grid', 'masonry', 'table']).optional(),
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
  /**
   * Site-wide default for the H1 above page content.
   *
   * Ported and designed layouts usually open with their own headline, so the
   * CMS adding a second one puts two titles on the page. This is the default;
   * an individual page can still override it (content.meta.hideTitle).
   */
  showPageTitles: z.boolean().optional(),
});
// ─── Counter: store currency ───────────────────────────────────────────────
// Currency was the hardcoded string 'USD' in cart.service and 'en-US' in the
// order emails, so a non-US store could not sell in its own currency at all.
export const CommerceSettingsInput = z.object({
  currency: z.string().length(3).optional(),
  /** Overrides the currency's default locale for formatting. */
  locale: z.string().max(20).optional(),
  /**
   * The floor every discount has to respect, as a margin over COST.
   *
   * A percentage off retail says nothing about whether the sale still makes
   * money — 50% off is fine on a 4x markup and below cost on a 1.6x one, and
   * the difference is per product. So discounts are clamped against the
   * variant's own cost rather than trusted to be sensible.
   *
   * 0 disables the clamp. Variants with no cost recorded are not clamped —
   * there is nothing to compare against, and guessing a cost would be worse
   * than not guarding.
   */
  minMarginPct: z.number().int().min(0).max(95).optional(),
});

// ─── Counter: how the storefront PRESENTS itself ───────────────────────────
//
// Separate from `commerce` on purpose. Commerce holds facts about the store
// (its currency); this holds choices about its shopfront. Mixing them means a
// currency change and a card-layout change look like the same kind of edit,
// and the storefront ends up reading a settings blob where two thirds of the
// keys do not concern it.
export const CounterSettingsInput = z.object({
  // ── Cart ────────────────────────────────────────────────────────────────
  /** 'mini' drops a panel under the bag; 'sidebar' opens a full-height drawer. */
  cartStyle: z.enum(['mini', 'sidebar']).optional(),
  /**
   * How the sidebar arrives. 'overlay' slides it over the page (the source
   * theme's own behaviour); 'push' slides the PAGE aside so the drawer is
   * revealed from under it, and nothing is covered.
   */
  cartSidebarReveal: z.enum(['overlay', 'push']).optional(),
  // The ground uncovered behind a shifted page. Hex only: it is written
  // straight into a custom property, so anything looser is a style-injection
  // hole in every page of the storefront.
  cartSidebarGround: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #0a0a0a').optional(),

  // ── Product cards: three independent axes ───────────────────────────────
  /**
   * Does the card have a container, or is it just the image on the page?
   *   bare      no box — image on the page, text under it
   *   boxed     a surface with a hairline and a radius
   *   elevated  a soft raised surface with an inset image tile
   */
  cardShell: z.enum(['bare', 'boxed', 'elevated']).optional(),
  /**
   * What the card's image DOES. Each is a complete behaviour, not a flag to
   * combine — gallery arrows and a motion video fighting over the same hover
   * is exactly the mess this replaces.
   *   still    one image, nothing on hover
   *   fade     second image cross-fades in on hover
   *   gallery  arrows + dots to flip every image
   *   motion   hover plays the product video
   */
  cardMedia: z.enum(['still', 'fade', 'gallery', 'motion']).optional(),
  /**
   * What a product falls back to when it cannot support the primary — no
   * video for 'motion', one photo for 'gallery' or 'fade'.
   *
   * This used to be a hardcoded chain (motion -> fade -> still). Making it a
   * real choice is the difference between "some of my cards silently do
   * something else" and "products without video get arrows instead", which is
   * a decision the merchant should own.
   */
  cardMediaSecondary: z.enum(['still', 'fade', 'gallery', 'motion']).optional(),
  /** Which rows of information the card carries. */
  cardPreset: z.enum(['editorial', 'retail', 'detailed', 'sneaker', 'data']).optional(),
  /**
   * Where the buy action lives.
   *   none     the card links to the product page — no add-to-cart at all
   *   below    one button under the price
   *   overlay  floating on the image, revealed on hover
   *   dual     Add to cart + Explore
   *   icons    heart + bag icon buttons
   */
  cardAction: z.enum(['none', 'below', 'overlay', 'dual', 'icons']).optional(),
  /**
   * Evolve: an add-to-cart on a product with choices flips the card into an
   * in-place colour/size picker instead of sending the shopper to the PDP.
   *
   * This used to be its own cardAction value, which was wrong — it is a
   * MODIFIER on whatever add-to-cart the card already has, and there is no
   * reason a Below or Icons card cannot do it too. Only 'none' is exempt,
   * because a card with no add-to-cart has nothing to evolve.
   */
  cardEvolve: z.boolean().optional(),
  /** How the text block under the image is aligned. */
  cardAlign: z.enum(['start', 'center', 'end']).optional(),
  /**
   * Corner treatment for the card and its image.
   *   sharp      no radius at all
   *   soft/round/pill  an increasing radius
   *   squircle   a superellipse — the continuous corner, not an arc. Needs
   *              CSS corner-shape; browsers without it get the round radius,
   *              which is the closest thing that exists rather than a broken
   *              shape.
   */
  cardRadius: z.enum(['sharp', 'soft', 'round', 'pill', 'squircle']).optional(),
  /** Image proportion. 'natural' lets the photo decide. */
  cardRatio: z.enum(['square', 'portrait', 'tall', 'landscape', 'natural']).optional(),
  /** Whether the image fills its frame or fits inside it. */
  cardFit: z.enum(['cover', 'contain']).optional(),
  /** Depth on boxed/elevated shells. Bare cards have nothing to cast one. */
  cardShadow: z.enum(['none', 'soft', 'strong']).optional(),
  /** What the card does under the cursor. */
  cardHover: z.enum(['none', 'lift', 'zoom', 'both']).optional(),
  /** Space between cards. */
  cardGap: z.enum(['tight', 'normal', 'roomy']).optional(),
  /**
   * How the card's content arrives when it scrolls into view.
   *   none     no animation
   *   fade     the whole card fades in
   *   rise     it fades in and lifts a few pixels
   *   stagger  the rows arrive one after another
   */
  cardReveal: z.enum(['none', 'fade', 'rise', 'stagger']).optional(),
  /** Category/vendor line under the product name. */
  cardSubtitle: z.boolean().optional(),
  /** Sold-out / low-stock marks on the image. */
  cardBadges: z.boolean().optional(),
  /**
   * How a milieu member's price is SHOWN.
   *   off      members see list price on the storefront; the discount still
   *            lands at checkout
   *   net      the member price IS the price. No strike-through.
   *   was-now  list price struck through beside the member price
   *
   * 'net' is the default and the reason is the mechanic: a strike-through is
   * a SALE device — it works because it is temporary. A membership is a
   * standing relationship, so a permanent "was $80" only makes the $80 look
   * dishonest. Sale pricing (compareAtPrice) keeps its strike-through; these
   * are two different things and should not look the same.
   */
  memberPricing: z.enum(['off', 'net', 'was-now']).optional(),
  /** The quiet "Friends & Family price" line under a member price. */
  memberPriceLabel: z.string().max(40).optional(),

  /**
   * Where a contact-form topic is routed.
   *
   * The address is chosen SERVER-SIDE from the topic id — the browser sends
   * which topic was picked, never an address. A form that posts its own
   * recipient is an open relay with a nice font.
   */
  contactTopics: z.array(z.object({
    id: z.string().min(1).max(40),
    label: z.string().min(1).max(60),
    email: z.string().email().max(320),
    /** Extra fields this topic asks for, beyond name/email/message. */
    fields: z.array(z.enum(['order', 'instagram', 'portfolio', 'company', 'budget'])).default([]),
    blurb: z.string().max(200).optional(),
  })).max(12).optional(),

  // ── Shop toolbar ────────────────────────────────────────────────────────
  toolbarEnabled: z.boolean().optional(),
  /**
   * How the toolbar presents itself.
   *   bar      the full flat bar: search across the top, control pills under it
   *   minimal  just icons. Clicking one expands it into the control in place
   *            and collapses whatever was open — the toolbar takes up a row
   *            until it is actually being used.
   */
  toolbarStyle: z.enum(['bar', 'minimal']).optional(),
  toolbarSearch: z.boolean().optional(),
  /** Placeholder in the search field. Empty falls back to "Search products…". */
  toolbarSearchPlaceholder: z.string().max(60).optional(),
  toolbarSort: z.boolean().optional(),
  toolbarView: z.boolean().optional(),
  toolbarCount: z.boolean().optional(),
  /** Default column count for the grid; shoppers can still change it. */
  toolbarColumns: z.number().int().min(2).max(6).optional(),
  /**
   * Products per page. Was hardcoded at 60. Bounded at 120 because the grid
   * ships every card's markup inline — past that the page weight is the
   * problem, not the query.
   */
  toolbarPageSize: z.number().int().min(4).max(120).optional(),
  /**
   * WHICH filters to offer, not just whether to offer any. A store whose
   * products have no colour variants should not show a Colour pill that opens
   * an empty list — and that is a merchant's call, not something to infer.
   * Empty array = no filters at all.
   */
  toolbarFilterFields: z.array(z.enum(['category', 'tags', 'color', 'size', 'brand', 'price', 'availability'])).optional(),
  /**
   * Which sort options to offer, in the order they appear.
   *
   * Price and best-selling are REAL here — price sorts on the minimum variant
   * price and best-selling on actual order-item counts. Neither could be
   * offered before: price lives on variants, not products, so it needs an
   * aggregate rather than a column, and offering it while secretly sorting by
   * something else would be worse than not offering it.
   */
  toolbarSorts: z.array(z.enum(['new', 'oldest', 'name', 'name-desc', 'price-asc', 'price-desc', 'best-selling'])).optional(),
  /** Which of them a shopper lands on. Must be one of the offered set. */
  toolbarDefaultSort: z.enum(['new', 'oldest', 'name', 'name-desc', 'price-asc', 'price-desc', 'best-selling']).optional(),

  // ── Header search ───────────────────────────────────────────────────────
  /**
   * What the header magnifier does.
   *   takeover   a full-screen panel over the page
   *   inline     a panel docked under the header; the page stays put
   *   immersive  the PAGE empties — grid, toolbar and all — and refills with
   *              results as the shopper types. The search becomes the page
   *              rather than sitting on top of it.
   */
  searchStyle: z.enum(['takeover', 'inline', 'immersive']).optional(),

  // ── Wishlist ────────────────────────────────────────────────────────────
  wishlistEnabled: z.boolean().optional(),
  /** The heart on product cards. Off leaves the /wishlist page reachable. */
  wishlistOnCards: z.boolean().optional(),
});
export type CounterSettingsInput = z.infer<typeof CounterSettingsInput>;
// ─── Counter: payment client config ────────────────────────────────────────
// Publishable keys and the Apple Pay domain association file. These are all
// values designed to be PUBLIC — the browser SDK needs them — so they live in
// ordinary settings rather than the Nexus vault, which holds only secrets.
export const PaymentsSettingsInput = z.object({
  stripePublishableKey: z.string().max(200).optional(),
  squareApplicationId: z.string().max(200).optional(),
  environment: z.enum(['live', 'sandbox']).optional(),
  /** Verbatim contents of Apple's domain-association file. */
  appleDomainAssociation: z.string().max(20000).optional(),
});
// ─── Stealth ───────────────────────────────────────────────────────────────
// Reduces what an unauthenticated scanner learns about the stack. This is
// obscurity, NOT security — it stops nothing that a determined attacker
// cannot work around. What it does do is drop this install out of the
// automated mass-scans that fingerprint a platform and fire known exploits
// at whatever matches, which is the overwhelming majority of real traffic.
export const StealthSettingsInput = z.object({
  /** Remove "Powered by Therum OS" from the public footer. */
  hidePlatformCredit: z.boolean().optional(),
  /** Strip the version number from the sign-in screen. */
  hideVersion: z.boolean().optional(),
  /** Serve a plain 404 on the admin path unless the request carries this. */
  adminKnock: z.string().max(80).optional(),
});
export type StealthSettingsInput = z.infer<typeof StealthSettingsInput>;

// ─── Security ──────────────────────────────────────────────────────────────
// Unlike Stealth above, these are real controls, not obscurity.
export const SecuritySettingsInput = z.object({
  /**
   * Require every admin account to hold a second factor.
   *
   * Enforced on the credential, not at the login form: an account without
   * TOTP can still sign in with its password, but its session can reach
   * nothing except the enrolment endpoints until it enrols. Blocking the
   * login outright would lock out every existing account the moment this is
   * switched on, including the one that switched it on.
   */
  requireTwoFactor: z.boolean().optional(),
});
export type SecuritySettingsInput = z.infer<typeof SecuritySettingsInput>;

export type PaymentsSettingsInput = z.infer<typeof PaymentsSettingsInput>;

export type CommerceSettingsInput = z.infer<typeof CommerceSettingsInput>;

// ─── Maintenance / Coming soon ─────────────────────────────────────────────
// Built into Therum OS rather than being a page someone remembers to publish.
// A maintenance page that lives as ordinary content is one an editor can
// unpublish, and one that cannot cover routes the CMS does not own.
export const MaintenanceSettingsInput = z.object({
  /**
   * 'maintenance' — the site exists and is temporarily down. Answers 503 with
   *   Retry-After so search engines keep the real pages and come back.
   * 'coming-soon' — the site is not launched yet. Answers 200: it IS the page,
   *   and a 503 on a launch teaser tells crawlers the site is broken.
   * The distinction is the whole reason these are one feature with two modes.
   */
  mode: z.enum(['off', 'maintenance', 'coming-soon']).optional(),
  heading: z.string().max(120).optional(),
  message: z.string().max(600).optional(),
  buttonLabel: z.string().max(40).optional(),
  buttonHref: z.string().max(300).optional(),
  /** Full-bleed background image (media library URL). */
  backgroundImage: z.string().max(500).optional(),
  /** Minutes for Retry-After. 0 omits the header. */
  retryAfterMinutes: z.number().int().min(0).max(10080).optional(),
});
export type MaintenanceSettingsInput = z.infer<typeof MaintenanceSettingsInput>;

export type SiteSettingsInput = z.infer<typeof SiteSettingsInput>;
