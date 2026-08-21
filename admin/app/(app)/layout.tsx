import type { ReactNode, CSSProperties } from 'react';
import { CommandPalette } from './CommandPalette';
import { headers } from 'next/headers';
import { apiGet } from '../../lib/api';
import { buildNav, type StudioNavItem } from '../../lib/nav';
import { applySidebarLayout, type SidebarLayout } from '../../lib/sidebar-layout';
import { DEFAULT_APPEARANCE, appearanceDataAttrs, appearanceInlineVars, type Appearance } from '../../lib/appearance';
import { PageMotion } from './PageMotion';
import { NavProgress } from './NavProgress';
import { Sidebar } from './Sidebar';
import { TwoFactorGate } from './TwoFactorGate';
import { Topbar } from './Topbar';
import { DesktopShell } from './DesktopShell';

interface CapabilitySummary {
  id: string;
  active: string | null;
}
interface Me {
  username: string;
  sidebarLayout: SidebarLayout | null;
  desktopModeEnabled: boolean;
  loginLandingPage: string | null;
  sidebarFolded: boolean;
  listPageRowCount: number | null;
  customCss: string;
  mustEnrollTwoFactor?: boolean;
}
interface About {
  version: string;
  database: string;
}
interface StudioAppRow {
  id: string;
  navLabel: string;
  navHref: string;
  enabled: boolean;
  curatedSection?: boolean;
}

// Per-app sidebar icons for enabled Studio Apps; anything unmapped falls
// back to the generic studio mark.
const STUDIO_APP_ICONS: Record<string, StudioNavItem['icon']> = {
  nexus: 'webhook',
  milieus: 'users',
  cluster: 'widgets',
};

// The authenticated admin shell — everything under this route group requires
// a valid session (enforced by middleware.ts before the request ever reaches here).
// Store is a real capability toggle (System > Extensions), off unless
// explicitly enabled. Case Studies/Portfolio is NOT a capability at all in
// 1.9.44 — it's gated by a single option (therum_case_studies_enabled) that
// a Studio module toggle flips, defaulting off. That Studio page doesn't
// exist yet in 2.0, so Portfolio is hardcoded hidden here rather than wired
// to the wrong (capability) mechanism — comes back once Studio is built.
// The login screen (admin/app/login) reads the same colorMode setting via
// the public /api/settings/appearance/public endpoint, so light/dark stays
// consistent across the auth boundary instead of the login page picking its
// own fixed look.
export default async function AppLayout({ children }: { children: ReactNode }) {
  let commerceActive = false;
  try {
    const caps = await apiGet<CapabilitySummary[]>('/api/capabilities');
    commerceActive = Boolean(caps.find((c) => c.id === 'commerce')?.active);
  } catch {
    // Capability service unreachable — fail closed (no Store section)
    // rather than guessing; the rest of the admin still renders.
  }
  const appearance = await apiGet<Appearance>('/api/settings/appearance').catch((): Appearance => DEFAULT_APPEARANCE);
  const me = await apiGet<Me>('/api/me').catch(
    (): Me => ({ username: 'admin', sidebarLayout: null, desktopModeEnabled: false, loginLandingPage: null, sidebarFolded: false, listPageRowCount: null, customCss: '' }),
  );
  // 2FA is required and this account has not enrolled: render enrolment IN
  // PLACE of the app, on every route.
  //
  // Not a redirect. A layout cannot see the current path in Next 16, so a
  // redirect would either loop on the target page or need a header that isn't
  // reliably there. Rendering instead makes the rule unconditional — there is
  // no route that skips it — and it matches what the API already enforces, so
  // the UI cannot promise access the backend will refuse.
  if (me.mustEnrollTwoFactor) {
    const status = await apiGet<{ enabled: boolean; unusedBackupCodes: number }>('/api/auth/2fa').catch(() => ({
      enabled: false,
      unusedBackupCodes: 0,
    }));
    return <TwoFactorGate username={me.username} status={status} appearance={appearance} />;
  }

  const about = await apiGet<About>('/api/system/about').catch((): About => ({ version: '2.0.0', database: 'PostgreSQL' }));
  // The sidebar shows the SITE's identity (as 1.9.44 did), not the CMS
  // product name — this admin can run any site.
  const site = await apiGet<{ siteName?: string }>('/api/settings/site').catch(() => ({ siteName: undefined }));
  const siteName = site.siteName?.trim() || 'Therum CMS';

  // Enabled Studio Apps surface their own nav entries under Studio (the
  // registry's design); unreachable backend just means no extra entries.
  // Apps flagged curatedSection own a curated sidebar section instead
  // (Case Studies → Portfolio) and are skipped here to avoid double nav.
  const studioApps = await apiGet<StudioAppRow[]>('/api/studio-apps').catch((): StudioAppRow[] => []);
  const studioNavItems: StudioNavItem[] = studioApps
    .filter((a) => a.enabled && !a.curatedSection)
    .map((a) => ({ href: a.navHref, label: a.navLabel, icon: STUDIO_APP_ICONS[a.id] ?? 'studio' }));

  // The 1.9.44 therum_case_studies_enabled option, reborn as the Case
  // Studies Studio App: enabling it is what makes Portfolio real.
  const portfolioActive = studioApps.some((a) => a.id === 'case-studies' && a.enabled);

  const defaultNav = buildNav(commerceActive, portfolioActive, studioNavItems);
  // Counter is the only currently-gated curated section (Portfolio stays out
  // until a portfolio-flavored content type exists — see buildNav above);
  // ports therum_curated_section_ids()'s role of forcing gated sections back
  // even if the user's saved layout deleted them.
  //
  // 'store' stays in the list alongside 'counter': the section was renamed,
  // and a saved sidebar layout from before the rename still refers to it by
  // the old id. Keeping both means an existing user's layout does not quietly
  // lose the section on upgrade.
  const curatedIds = [...(commerceActive ? ['counter', 'store'] : []), ...(portfolioActive ? ['portfolio'] : [])];
  const sections = applySidebarLayout(defaultNav, me.sidebarLayout, curatedIds);
  // 1.9.44 shows $home_host (the site's own domain) here. 2.0 now serves the
  // public site on this same origin, so that IS the site's host — but the
  // admin runs behind a reverse proxy (see src/api/adminProxy.ts), which
  // means `host` is the internal upstream (127.0.0.1:3100). The forwarded
  // host is the address the browser actually used, so prefer it.
  const requestHeaders = await headers();
  const siteHost = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost';

  // A page opened inside a Desktop Mode window arrives here too (it's the
  // same route, just with ?embed=1) — render it bare, no sidebar/topbar,
  // since the floating window is already that page's "frame." See
  // middleware.ts for where this header gets set from the query param.
  if (requestHeaders.get('x-th-embed') === '1') {
    return <div id="th-embed-root">{children}</div>;
  }

  // Full attribute/inline-var set applies in both branches below — most of
  // Quick Controls (typography, accent, motion, accessibility) is universal
  // chrome, not specific to the standard shell vs. Desktop Mode. Selectors
  // with no matching target in a given shell (e.g. [data-card-grid-gap] has
  // nothing to select inside DesktopShell) are simply inert there, not wrong.
  const dataAttrs = appearanceDataAttrs(appearance);
  // Server-rendered so a folded rail is already folded at first paint —
  // setting it from the client would unfold-then-fold on every load.
  if (appearance.sidebarFoldable && me.sidebarFolded) dataAttrs['data-sidebar-folded'] = 'on';
  const inlineVars = appearanceInlineVars(appearance);

  if (me.desktopModeEnabled) {
    return (
      <div id="th-shell" data-desktop-mode="1" {...dataAttrs} style={inlineVars as CSSProperties}>
      <PageMotion />
      <NavProgress />
        <DesktopShell
          sections={sections}
          username={me.username}
          version={about.version}
          appearance={appearance}
          behavior={{ loginLandingPage: me.loginLandingPage, sidebarFolded: me.sidebarFolded, listPageRowCount: me.listPageRowCount, customCss: me.customCss }}
        />
        {me.customCss && <style dangerouslySetInnerHTML={{ __html: me.customCss }} />}
      </div>
    );
  }

  return (
    <div id="th-shell" {...dataAttrs} style={inlineVars as CSSProperties}>
      <PageMotion />
      <NavProgress />
      {/* Gated by Appearance > Workspace > Keyboard shortcuts. */}
      <CommandPalette enabled={appearance.keyboardShortcuts} />
      <aside id="th-sb">
        <Sidebar sections={sections} siteName={siteName} siteHost={siteHost} version={about.version} database={about.database} startFolded={me.sidebarFolded} />
      </aside>
      <div id="th-main">
        <Topbar
          sections={sections}
          colorMode={appearance.colorMode}
          username={me.username}
          desktopModeEnabled={me.desktopModeEnabled}
          appearance={appearance}
          behavior={{ loginLandingPage: me.loginLandingPage, sidebarFolded: me.sidebarFolded, listPageRowCount: me.listPageRowCount, customCss: me.customCss }}
        />
        <main id="th-content">{children}</main>
      </div>
      {/* Sanitized at write time (me.service.ts's sanitizeCustomCss) — safe to
          inject as-is here, this isn't re-sanitizing untrusted input at
          render time. */}
      {me.customCss && <style dangerouslySetInnerHTML={{ __html: me.customCss }} />}
    </div>
  );
}
