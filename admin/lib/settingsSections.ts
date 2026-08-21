import type { IconName } from '../app/(app)/icons';

export interface SettingsSection {
  id: string;
  label: string;
  description: string;
  icon: IconName;
}

// Matches 1.9.44's real Settings registry exactly (Therum_Settings::register(),
// ordered by its `priority` field — see mu-plugins research). Appearance is
// NOT one of these 16: in 1.9.44 it lives on a separate Customization/Admin
// Theme surface, not inside the Settings page's own section list (confirmed
// by a code comment at therum-admin.php:5081-5083) — see admin/app/(app)/
// appearance/page.tsx for where it actually lives in 2.0.
export const SETTINGS_SECTIONS: SettingsSection[] = [
  // "Site" is a 2.0-NATIVE addition, explicitly outside the 1.9.44 parity
  // list below (documented here, not silently slipped in): the Base Theme
  // public frontend needs a home for site identity, homepage assignment,
  // and the nav menu — none of which existed in WP-era 1.9.44, where the
  // theme owned them.
  { id: 'site', label: 'Site', description: 'Site name, tagline, homepage, and navigation menu for the public frontend.', icon: 'externalLink' },
  { id: 'admin-dock', label: 'Admin Dock', description: 'Position, default mode, and mobile behaviour of the frontend admin dock.', icon: 'dock' },
  { id: 'login', label: 'Login', description: 'Login screen background and branding.', icon: 'lock' },
  // Plugin Compatibility removed for now — this stack has no plugin
  // ecosystem, so it was always going to render empty. Comes back if/when
  // there's an extension system to actually be compatible with something.
  { id: 'security', label: 'Security', description: 'Hardening this install actually has.', icon: 'shield' },
  // Reports on the HOST, where Security above configures the APP. Kept next to
  // it because that is where you look when the question is "is this box ok".
  { id: 'advisor', label: 'Advisor', description: 'Scans this machine for security, compression and performance issues.', icon: 'gauge' },
  // The pair to Advisor: it says what is wrong, this runs the fix. Separate
  // page rather than buttons on the findings list, because most of what an
  // operator wants here (restart a process, read the nginx log) is not a
  // finding at all.
  { id: 'server', label: 'Server', description: 'Restart services, work the firewall, read logs — the control panel this box does not need to install.', icon: 'shield' },
  { id: 'permissions', label: 'Permissions', description: 'Role capabilities.', icon: 'users' },
  { id: 'performance', label: 'Performance', description: 'Cache, lazy load, defer JS.', icon: 'gauge' },
  { id: 'editor-defaults', label: 'Editor Defaults', description: 'Content builder preferences.', icon: 'edit2' },
  // Counter's own settings (Customization) and Payments both live under the
  // Counter section in the sidebar, not here — they are about running the
  // STORE, and a merchant changing a product card should not have to go
  // looking under the same roof as SMTP and backups. /settings/counter and
  // /settings/payments still resolve; they redirect to the new homes.
  { id: 'uploads', label: 'Uploads', description: 'File types, max size, processing.', icon: 'media' },
  { id: 'redirects', label: 'Redirects', description: '301/302 redirects + 404 monitor.', icon: 'externalLink' },
  { id: 'maintenance', label: 'Maintenance', description: 'Maintenance + coming soon holding page.', icon: 'shield' },
  { id: 'notifications', label: 'Notifications', description: 'Email, Slack, webhooks.', icon: 'bell' },
  { id: 'activity', label: 'Activity', description: 'Audit trail of changes.', icon: 'clock' },
  { id: 'updates', label: 'Updates', description: 'Versions and update behaviour.', icon: 'import' },
  { id: 'tools', label: 'Tools', description: 'Find & replace, DB cleanup, link checker.', icon: 'settings' },
  { id: 'backup', label: 'Backup', description: 'Schedule + restore.', icon: 'db' },
  // Experiments removed too — its only content is a toggle for Desktop Mode,
  // a third-party WordPress plugin with no equivalent here. Same situation
  // as Plugin Compatibility above.
  { id: 'about', label: 'About', description: 'Version, credits, system info.', icon: 'info' },
];
