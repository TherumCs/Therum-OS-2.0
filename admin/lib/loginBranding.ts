// Shared shape for the Settings > Login domain (GET/PATCH
// /api/settings/login-branding, public read at .../public for the
// pre-auth login screen itself) — mirrors src/services/settings.service.ts's
// LoginBranding interface + LOGIN_DEFAULTS exactly.
export interface LoginBranding {
  bgType: 'theme' | 'solid' | 'image' | 'video';
  bgColor: string;
  bgImage: string;
  bgVideo: string;
  bgOverlay: boolean;
  heading: string;
  subhead: string;
  showVersion: boolean;
}

export const DEFAULT_LOGIN_BRANDING: LoginBranding = {
  bgType: 'theme',
  bgColor: '#0a0a0a',
  bgImage: '',
  bgVideo: '',
  bgOverlay: true,
  heading: 'Welcome back',
  subhead: 'Sign in to your workspace',
  showVersion: true,
};
