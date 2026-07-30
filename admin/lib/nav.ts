import type { IconName } from '../app/(app)/icons';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

// Sectioned sidebar IA — matches therum_nav()'s real, current section list
// verbatim (mu-plugins/therum-admin.php lines 168-317): Content / Site /
// Workspace / Studio / System, with Store/Portfolio prepended as gated
// curated sections. An earlier pass here concluded "Site"/"System" were
// unshipped renames based on a screenshot of a live (customized) site — that
// was wrong; the zip's therum_nav() is the actual function building the
// actual rendered nav, and its own comments confirm the rename ("SYSTEM —
// admin infrastructure/plumbing. Renamed from 'Admin' so it no longer
// overloads two meanings") is live, not aspirational.
//
// Site (Design System/Themes/Menus/Widgets/Templates) and Workspace's real
// 1.9.44 sibling items, plus Connections and Updates under System, have no
// built pages in 2.0 yet — omitted rather than linked as dead buttons; they
// come back once built (see tasks for Site section, Connections, Updates).
// Workspace ships now because its one real item, Appearance, already has a
// real page at /settings/appearance.
// Store and Portfolio are both hidden unless active (Store needs commerce on;
// Portfolio needs a portfolio-flavored content type actually in use).
// A Studio App, once enabled, reveals its own nav entry under the Studio
// section (the registry's stated design — see src/services/studioApp.service.ts).
export interface StudioNavItem {
  href: string;
  label: string;
  icon: IconName;
}

export function buildNav(commerceActive: boolean, portfolioActive: boolean, studioApps: StudioNavItem[] = []): NavSection[] {
  const sections: NavSection[] = [];

  if (commerceActive) {
    // Named for the engine, not the generic noun — this stack's storefront IS
    // Counter, the same way the connections surface is Nexus and the customer
    // groups are Milieus. "Store" was the only section still calling its
    // engine by a category name.
    //
    // Customization and Payments moved OUT of Settings and in here: both are
    // about running this store, and a merchant changing a product card should
    // not have to go looking under the same roof as SMTP and backups.
    sections.push({
      id: 'counter',
      label: 'Counter',
      items: [
        { href: '/products', label: 'Products', icon: 'widgets' },
        { href: '/orders', label: 'Orders', icon: 'import' },
        { href: '/promotions', label: 'Promotions', icon: 'studio' },
        { href: '/customization', label: 'Customization', icon: 'palette' },
        // A mini-Nexus scoped to the store: who takes the money, who ships,
        // where products sync from. The full vault stays under Studio.
        { href: '/connections', label: 'Connections', icon: 'db' },
      ],
    });
  }

  sections.push({
    id: 'content',
    label: 'Content',
    items: [
      { href: '/pages', label: 'Pages', icon: 'page' },
      { href: '/posts', label: 'Posts', icon: 'post' },
      { href: '/media', label: 'Media', icon: 'media' },
      { href: '/import', label: 'Import', icon: 'import' },
    ],
  });

  if (portfolioActive) {
    sections.push({
      id: 'portfolio',
      label: 'Portfolio',
      items: [{ href: '/case-studies', label: 'Case Studies', icon: 'portfolio' }],
    });
  }

  sections.push(
    {
      id: 'workspace',
      label: 'Workspace',
      items: [{ href: '/appearance', label: 'Appearance', icon: 'palette' }],
    },
    {
      id: 'studio',
      label: 'Studio',
      items: [{ href: '/studio', label: 'From the Studio', icon: 'studio' }, ...studioApps],
    },
    {
      id: 'system',
      label: 'System',
      items: [
        { href: '/extensions', label: 'Plugins', icon: 'plugins' },
        { href: '/users', label: 'Users', icon: 'users' },
        { href: '/settings', label: 'Settings', icon: 'settings' },
      ],
    },
  );

  return sections;
}
