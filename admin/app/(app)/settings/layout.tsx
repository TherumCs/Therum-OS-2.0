import type { ReactNode } from 'react';
import { SettingsSectionNav } from './SettingsSectionNav';

// The container every settings screen plugs into — a left rail of registered
// sections + a content pane, same shape as 1.9.44's settings shell. A search
// box over the rail is a reasonable addition once there are enough sections
// to actually need searching (not yet, with one section registered).
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <section>
      <h1>Settings</h1>
      <div className="settings-shell">
        <SettingsSectionNav />
        <div className="settings-content">{children}</div>
      </div>
    </section>
  );
}
