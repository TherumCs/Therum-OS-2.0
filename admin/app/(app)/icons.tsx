// Inline stroke-icon set — SVG paths copied verbatim from 1.9.44's real
// therum_i() icon registry (mu-plugins/therum-admin.php), not redrawn
// approximations. Size/stroke-width preserved per-icon to match the source:
// nav-weight icons are 18px/1.6, small chrome icons are 13-16px/2-2.5.
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function svg(size: number, strokeWidth: number, props: IconProps, children: React.ReactNode) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...props}>
      {children}
    </svg>
  );
}

export const Icon = {
  // 'home' in the real registry — used for the standalone Dashboard link.
  dashboard: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </>
    )),
  // 'pages' in the real registry.
  page: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </>
    )),
  // 'posts' in the real registry.
  post: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </>
    )),
  // 'media' in the real registry.
  media: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </>
    )),
  // 'feather' in the real registry — the exact icon used for Portfolio /
  // Case Studies both in the curated-nav classifier and the Studio registry.
  portfolio: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
        <line x1="16" y1="8" x2="2" y2="22" />
        <line x1="17.5" y1="15" x2="9" y2="15" />
      </>
    )),
  // 'themes' in the real registry.
  themes: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <path d="M2 3h20v14H2z" />
        <path d="M8 21h8" />
        <path d="M12 17v4" />
      </>
    )),
  // 'menus' in the real registry.
  menus: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="15" y2="12" />
        <line x1="3" y1="18" x2="18" y2="18" />
      </>
    )),
  // 'widgets' in the real registry.
  widgets: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
      </>
    )),
  // 'therum' in the real registry (the brand mark) — used for the "From the
  // Studio" nav item; there's no separate 'studio' icon in the source.
  studio: (p: IconProps) =>
    svg(18, 1.6, p, <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />),
  // 'plugins' in the real registry.
  plugins: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <path d="M9 2v6" />
        <path d="M15 2v6" />
        <path d="M12 17v5" />
        <path d="M5 8h14" />
        <path d="M6 11V8h12v3a6 6 0 0 1-12 0Z" />
      </>
    )),
  // 'users' in the real registry.
  users: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
      </>
    )),
  // 'import' in the real registry.
  import: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </>
    )),
  // 'settings' in the real registry.
  settings: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M4.93 19.07l1.41-1.41M19.07 19.07l-1.41-1.41M12 2v2M12 20v2M2 12h2M20 12h2" />
      </>
    )),
  // 'profile' in the real registry.
  account: (p: IconProps) =>
    svg(14, 2, p, (
      <>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </>
    )),
  // 'search' in the real registry.
  search: (p: IconProps) =>
    svg(16, 2, p, (
      <>
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </>
    )),
  // 'sun' in the real registry.
  sun: (p: IconProps) =>
    svg(16, 2, p, (
      <>
        <circle cx="12" cy="12" r="5" />
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" />
        <line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </>
    )),
  // Topbar > Desktop Mode toggle — the exact icon 1.9.44's therum_i() uses
  // inside #th-desktop-toggle wasn't confirmed in the read source range, but
  // this is an unambiguous monitor pictograph for a desktop-mode control.
  monitor: (p: IconProps) =>
    svg(16, 2, p, (
      <>
        <rect x="2" y="4" width="20" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </>
    )),
  // 'external' in the real registry.
  externalLink: (p: IconProps) =>
    svg(14, 2, p, (
      <>
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </>
    )),
  // 'edit2' in the real registry.
  edit: (p: IconProps) =>
    svg(13, 2, p, (
      <>
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" />
      </>
    )),
  // 'logout' in the real registry.
  logout: (p: IconProps) =>
    svg(14, 2, p, (
      <>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </>
    )),
  // 'palette' in the real registry — Workspace > Appearance.
  palette: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
        <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
        <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
        <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
      </>
    )),
  // 'edit2' in the real registry — reused here for the section-rename control
  // (distinct instance from `edit` above since it needs 13px, not the topbar's).
  edit2: (p: IconProps) =>
    svg(13, 2, p, (
      <>
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </>
    )),
  // 'x' in the real registry — section delete control.
  x: (p: IconProps) =>
    svg(13, 2.5, p, (
      <>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </>
    )),
  // 'check' in the real registry — sidebar edit-bar Save button.
  check: (p: IconProps) => svg(14, 2.5, p, <polyline points="20 6 9 17 4 12" />),
  // 'plus' in the real registry — Add section button.
  plus: (p: IconProps) =>
    svg(14, 2.5, p, (
      <>
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </>
    )),
  // 'chevron' in the real registry — section collapse toggle.
  chevron: (p: IconProps) => svg(14, 2, p, <polyline points="9 18 15 12 9 6" />),
  // 'shield' in the real registry — Settings > Security.
  shield: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
        <path d="m9 12 2 2 4-4" />
      </>
    )),
  // 'info' in the real registry — Settings > About.
  info: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </>
    )),
  // 'lock' in the real registry — Settings > Login.
  lock: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <rect x="4" y="11" width="16" height="11" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </>
    )),
  // 'webhook' in the real registry — Settings > Plugin Compatibility.
  webhook: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2" />
        <path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" />
        <path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8" />
      </>
    )),
  // 'gauge' in the real registry — Settings > Performance.
  gauge: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <path d="m12 14 4-4" />
        <path d="M3.34 19a10 10 0 1 1 17.32 0" />
      </>
    )),
  // 'bell' in the real registry — Settings > Notifications.
  bell: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </>
    )),
  // 'db' in the real registry — Settings > Backup.
  db: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </>
    )),
  // 'dock' in the real registry — Settings > Admin Dock.
  dock: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <rect x="2" y="15" width="20" height="6" rx="2" />
        <line x1="7" y1="15" x2="7" y2="10" />
        <line x1="12" y1="15" x2="12" y2="5" />
        <line x1="17" y1="15" x2="17" y2="10" />
      </>
    )),
  // Settings > Activity — not a confirmed therum_i() key (registry dump
  // didn't include one named 'clock'), but this is a standard, unambiguous
  // pictograph for an audit/activity timeline.
  clock: (p: IconProps) =>
    svg(18, 1.6, p, (
      <>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </>
    )),
} as const;

export type IconName = keyof typeof Icon;
