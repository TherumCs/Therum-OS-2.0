import type { ReactNode } from 'react';
import { AppearanceSectionNav } from './AppearanceSectionNav';

// Same container as SettingsLayout — rail + content pane, same classes. This
// page used to be a 3-column card board, which read as a different product
// sitting next to Settings.
export default function AppearanceLayout({ children }: { children: ReactNode }) {
  return (
    <section>
      <h1>Appearance</h1>
      <div className="settings-shell">
        <AppearanceSectionNav />
        <div className="settings-content">{children}</div>
      </div>
    </section>
  );
}
