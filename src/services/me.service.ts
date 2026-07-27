import { Prisma } from '@prisma/client';
import { db } from '../lib/db.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import type { DashboardLayoutInput, SidebarLayoutInput, BehaviorInput } from '../schemas/settings.schema.js';

// Custom CSS is scoped to one user's own admin view only, but still gets
// real sanitization, not just a length cap — strips the classic CSS-as-
// script-execution vectors (old-IE `expression()`/`behavior:`, Firefox's
// `-moz-binding`, `@import` which can exfiltrate via request timing/URL,
// and `url(javascript:...)`), matching the source's own "sanitized" framing.
function sanitizeCustomCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/-moz-binding\s*:[^;]*;?/gi, '')
    .replace(/behavior\s*:[^;]*;?/gi, '')
    .replace(/url\s*\(\s*['"]?\s*javascript:[^)]*\)/gi, 'url()')
    .replace(/<\/?script[^>]*>/gi, '');
}

export interface DashboardCard {
  id: string;
  size: 'xs' | 'sm' | 'md' | 'lg';
}

// Default order/size for a fresh account — matches 1.9.44's real
// therum_render_dashboard() bento order: Pages, Posts, (Products if
// commerce), Users, Recent activity, Site health.
const DEFAULT_LAYOUT: DashboardCard[] = [
  { id: 'pages', size: 'xs' },
  { id: 'posts', size: 'xs' },
  { id: 'products', size: 'xs' },
  { id: 'users', size: 'xs' },
  { id: 'recent-activity', size: 'md' },
  { id: 'site-health', size: 'xs' },
];

export const meService = {
  async get(userId: string) {
    const user = await db.adminUser.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        dashboardLayout: true,
        sidebarLayout: true,
        desktopModeEnabled: true,
        mediaViewMode: true,
        mediaDensity: true,
        loginLandingPage: true,
        sidebarFolded: true,
        listPageRowCount: true,
        customCss: true,
      },
    });
    if (!user) throw new NotFoundError('Admin user not found', 'id');
    const layout = Array.isArray(user.dashboardLayout) ? (user.dashboardLayout as unknown as DashboardCard[]) : DEFAULT_LAYOUT;
    const sidebarLayout = isSidebarLayout(user.sidebarLayout) ? user.sidebarLayout : null;
    return {
      id: user.id,
      username: user.username,
      dashboardLayout: layout,
      sidebarLayout,
      desktopModeEnabled: user.desktopModeEnabled,
      mediaViewMode: user.mediaViewMode ?? 'grid',
      mediaDensity: user.mediaDensity ?? 5,
      loginLandingPage: user.loginLandingPage,
      sidebarFolded: user.sidebarFolded,
      listPageRowCount: user.listPageRowCount,
      customCss: user.customCss ?? '',
    };
  },

  async setDashboardLayout(userId: string, input: DashboardLayoutInput) {
    await this.get(userId); // 404s if the user vanished mid-session
    await db.adminUser.update({ where: { id: userId }, data: { dashboardLayout: input.cards as unknown as Prisma.InputJsonValue } });
    return { cards: input.cards };
  },

  // Matches 1.9.44's edit-layout bar "Reset" button — clears the stored
  // layout so `get()` falls back to DEFAULT_LAYOUT again.
  async resetDashboardLayout(userId: string) {
    await this.get(userId);
    await db.adminUser.update({ where: { id: userId }, data: { dashboardLayout: Prisma.DbNull } });
    return { cards: DEFAULT_LAYOUT };
  },

  // Storage only — no default and no merge logic here. Unlike the dashboard
  // (a fixed card registry known server-side), the sidebar's "default nav" is
  // capability-gated and computed in admin/lib/nav.ts at request time, and
  // the merge (admin/lib/sidebar-layout.ts's applySidebarLayout, porting
  // therum_apply_sidebar_layout()) needs that live default — so it runs in
  // the Next.js layout, not here. This mirrors 1.9.44 exactly: therum_get_
  // sidebar_layout() is a raw user-meta read with no merge either.
  async setSidebarLayout(userId: string, input: SidebarLayoutInput) {
    await this.get(userId);
    await db.adminUser.update({ where: { id: userId }, data: { sidebarLayout: input as unknown as Prisma.InputJsonValue } });
    return { sections: input.sections, items: input.items };
  },

  // Matches 1.9.44's wp_ajax_therum_reset_sidebar — clears the stored layout
  // so `get()` returns null and the caller falls back to the untouched
  // default nav.
  async resetSidebarLayout(userId: string) {
    await this.get(userId);
    await db.adminUser.update({ where: { id: userId }, data: { sidebarLayout: Prisma.DbNull } });
    return { sidebarLayout: null };
  },

  async setDesktopMode(userId: string, enabled: boolean) {
    await this.get(userId);
    await db.adminUser.update({ where: { id: userId }, data: { desktopModeEnabled: enabled } });
    return { desktopModeEnabled: enabled };
  },

  // Matches 1.9.44's wp_ajax_therum_save_pref for the media_view_mode /
  // media_density keys — same "only touch the field that was actually sent"
  // shape (its density slider debounce-saves separately from the view
  // toggle's immediate save).
  async setMediaView(userId: string, input: { viewMode?: string; density?: number }) {
    await this.get(userId);
    const data: { mediaViewMode?: string; mediaDensity?: number } = {};
    if (input.viewMode !== undefined) data.mediaViewMode = input.viewMode;
    if (input.density !== undefined) data.mediaDensity = input.density;
    await db.adminUser.update({ where: { id: userId }, data });
    return { mediaViewMode: data.mediaViewMode, mediaDensity: data.mediaDensity };
  },

  // Quick Controls' Behavior tab — same "only touch what was sent" shape as
  // setMediaView above. listPageRowCount accepts null explicitly (clears the
  // per-user override, falling back to Appearance.itemsPerPage).
  async setBehavior(userId: string, input: BehaviorInput) {
    await this.get(userId);
    const data: Prisma.AdminUserUpdateInput = {};
    if (input.loginLandingPage !== undefined) data.loginLandingPage = input.loginLandingPage;
    if (input.sidebarFolded !== undefined) data.sidebarFolded = input.sidebarFolded;
    if (input.listPageRowCount !== undefined) data.listPageRowCount = input.listPageRowCount;
    await db.adminUser.update({ where: { id: userId }, data });
    return { loginLandingPage: input.loginLandingPage, sidebarFolded: input.sidebarFolded, listPageRowCount: input.listPageRowCount };
  },

  async setCustomCss(userId: string, css: string) {
    await this.get(userId);
    const clean = sanitizeCustomCss(css);
    await db.adminUser.update({ where: { id: userId }, data: { customCss: clean } });
    return { customCss: clean };
  },

  // Quick Controls' Advanced-tab export — everything needed to reproduce
  // this user's current setup: site-wide Appearance plus this user's own
  // Behavior fields. Callers merge in Appearance themselves (settingsService
  // owns that, not this file) — see the /settings/export route.
  async exportBehavior(userId: string) {
    const user = await this.get(userId);
    return {
      loginLandingPage: user.loginLandingPage,
      sidebarFolded: user.sidebarFolded,
      listPageRowCount: user.listPageRowCount,
      customCss: user.customCss,
    };
  },

  // Import is allow-listed field-by-field against BehaviorInput's own shape
  // — arbitrary extra keys in pasted JSON are silently dropped, not applied,
  // matching the source's "allow-listed against known fields so pasted
  // garbage can't corrupt state" framing exactly. customCss isn't part of
  // BehaviorInput (it's its own CustomCssInput domain) and needs the same
  // sanitizeCustomCss() pass as a direct save — routes to setCustomCss()
  // separately rather than through setBehavior(), which never touches it.
  async importBehavior(userId: string, raw: Record<string, unknown>) {
    const allowed: BehaviorInput = {};
    if (typeof raw.loginLandingPage === 'string') allowed.loginLandingPage = raw.loginLandingPage;
    if (typeof raw.sidebarFolded === 'boolean') allowed.sidebarFolded = raw.sidebarFolded;
    if (typeof raw.listPageRowCount === 'number' || raw.listPageRowCount === null) allowed.listPageRowCount = raw.listPageRowCount as number | null;
    const hasCustomCss = typeof raw.customCss === 'string';
    if (Object.keys(allowed).length === 0 && !hasCustomCss) throw new ValidationError('No recognized Behavior fields in the imported JSON.', 'behavior');
    if (Object.keys(allowed).length > 0) await this.setBehavior(userId, allowed);
    if (hasCustomCss) await this.setCustomCss(userId, raw.customCss as string);
    return this.get(userId);
  },
};

function isSidebarLayout(value: unknown): value is { sections: unknown[]; items: Record<string, unknown> } {
  return typeof value === 'object' && value !== null && Array.isArray((value as { sections?: unknown }).sections);
}
