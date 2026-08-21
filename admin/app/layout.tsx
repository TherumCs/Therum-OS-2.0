import type { ReactNode } from 'react';
import { Inter_Tight } from 'next/font/google';
import './globals.css';

// The real 1.9.44 default (`therum-themes.php`'s default_state(): displayFont
// 'inter-tight') — self-hosted via next/font so it's not a CDN dependency and
// there's no request-blocking <link> tag. Exposed as a CSS variable so
// therum-tokens.css's --th-font-display can reference it.
const interTight = Inter_Tight({ subsets: ['latin'], variable: '--font-inter-tight', display: 'swap' });

export const metadata = { title: 'Therum Admin', description: 'Therum CMS 2.0 admin' };

// Minimal root layout — no sidebar/shell here so /login can render standalone.
// The authenticated shell lives in app/(app)/layout.tsx.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={interTight.variable}>
      <body>{children}</body>
    </html>
  );
}
