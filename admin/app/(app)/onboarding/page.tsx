import type { ReactNode } from 'react';
import { apiGet } from '../../../lib/api';
import { onboardingSetEdition, onboardingSetStep, onboardingSaveBranding, onboardingComplete } from '../../actions';
import { DEFAULT_LOGIN_BRANDING, type LoginBranding } from '../../../lib/loginBranding';
import { DEFAULT_APPEARANCE, type Appearance } from '../../../lib/appearance';

export const dynamic = 'force-dynamic';

interface Onboarding {
  step: 'edition' | 'connections' | 'branding' | 'finish';
  completed: boolean;
}
const ONBOARDING_DEFAULTS: Onboarding = { step: 'edition', completed: false };

interface SeoDefaults {
  siteName: string;
  siteDescription: string;
  siteLogo: string;
}
const SEO_DEFAULTS: SeoDefaults = { siteName: '', siteDescription: '', siteLogo: '' };

const STEPS = ['edition', 'connections', 'branding', 'finish'] as const;
const STEP_LABELS: Record<(typeof STEPS)[number], string> = {
  edition: 'Edition',
  connections: 'Connections',
  branding: 'Branding',
  finish: 'Finish',
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--th-space-4)', marginBottom: 'var(--th-space-14)', fontSize: 13 }}>
      <span style={{ fontWeight: 600, color: 'var(--th-ink-2)' }}>{label}</span>
      {children}
    </label>
  );
}

function StepFooter({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--th-space-20)' }}>{children}</div>;
}

// Post-setup, in-app, skippable+resumable — separate from the pre-auth
// /login gate, which only ever handles account creation itself (see
// LoginScreen.tsx). Every step here writes through settingsService.onboarding
// (step + completed), so leaving mid-flow and coming back via the dashboard
// banner resumes exactly where it left off.
export default async function OnboardingPage() {
  const onboarding = await apiGet<Onboarding>('/api/settings/onboarding').catch(() => ONBOARDING_DEFAULTS);
  const [edition, seo, branding, appearance] = await Promise.all([
    apiGet<{ edition: 'pure' | 'unlocked' }>('/api/edition').catch(() => ({ edition: 'pure' as const })),
    apiGet<SeoDefaults>('/api/settings/seo-defaults').catch(() => SEO_DEFAULTS),
    apiGet<LoginBranding>('/api/settings/login-branding').catch(() => DEFAULT_LOGIN_BRANDING),
    apiGet<Appearance>('/api/settings/appearance').catch(() => DEFAULT_APPEARANCE),
  ]);

  const stepIndex = STEPS.indexOf(onboarding.step);

  return (
    <section style={{ maxWidth: 640 }}>
      <h1 className="th-dash-title" style={{ fontSize: 'var(--th-fs-lg)' }}>
        Set up Therum CMS
      </h1>

      <div className="onboarding-steps">
        {STEPS.map((s, i) => (
          <div key={s} className={'onboarding-step' + (i < stepIndex ? ' done' : i === stepIndex ? ' active' : '')}>
            <span className="onboarding-step-dot" />
            <span>{STEP_LABELS[s]}</span>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 'var(--th-space-20)' }}>
        {onboarding.step === 'edition' && (
          <>
            <h2 style={{ marginTop: 0 }}>Choose your edition</h2>
            <p className="muted">
              Pure is our native ecosystem, locked to native. Unlock to pair with others (Bricks, WordPress, ecosystem plugins). You can
              change this later in Studio.
            </p>
            <div style={{ display: 'flex', gap: 'var(--th-space-12)', marginBottom: 'var(--th-space-8)' }}>
              <form action={onboardingSetEdition.bind(null, 'pure')} style={{ flex: 1 }}>
                <button type="submit" className={edition.edition === 'pure' ? '' : 'ghost'} style={{ width: '100%', padding: 'var(--th-space-16)' }}>
                  Pure
                </button>
              </form>
              <form action={onboardingSetEdition.bind(null, 'unlocked')} style={{ flex: 1 }}>
                <button
                  type="submit"
                  className={edition.edition === 'unlocked' ? '' : 'ghost'}
                  style={{ width: '100%', padding: 'var(--th-space-16)' }}
                >
                  Unlocked
                </button>
              </form>
            </div>
            <StepFooter>
              <form action={onboardingComplete}>
                <button type="submit" className="ghost">
                  Skip setup
                </button>
              </form>
              <span />
            </StepFooter>
          </>
        )}

        {onboarding.step === 'connections' && (
          <>
            <h2 style={{ marginTop: 0 }}>Connections</h2>
            <p className="muted">Email, payments, storage, and other services connect from one hub.</p>
            <div className="notice">This hub isn&apos;t built yet — it&apos;s next on the roadmap, so there&apos;s nothing to configure here today.</div>
            <StepFooter>
              <form action={onboardingSetStep.bind(null, 'edition')}>
                <button type="submit" className="ghost">
                  ← Back
                </button>
              </form>
              <div style={{ display: 'flex', gap: 'var(--th-space-8)' }}>
                <form action={onboardingComplete}>
                  <button type="submit" className="ghost">
                    Skip setup
                  </button>
                </form>
                <form action={onboardingSetStep.bind(null, 'branding')}>
                  <button type="submit">Next →</button>
                </form>
              </div>
            </StepFooter>
          </>
        )}

        {onboarding.step === 'branding' && (
          <form action={onboardingSaveBranding}>
            <h2 style={{ marginTop: 0 }}>Branding</h2>
            <p className="muted">A few quick touches — all of this stays editable later in Settings. Leave anything blank to keep its current value.</p>
            <Field label="Site name">
              <input
                type="text"
                name="siteName"
                defaultValue={seo.siteName}
                placeholder="My Company"
                style={{ padding: 'var(--th-space-8) var(--th-space-10)', border: '1px solid var(--th-line)', borderRadius: 'var(--th-r)', fontSize: 13 }}
              />
            </Field>
            <Field label="Accent color">
              {/* type="color" can never be truly empty, so defaultValue must be the
                  REAL effective color (therum-tokens.css's --ac, not an arbitrary
                  fallback) — otherwise hitting Save without touching the swatch
                  would silently overwrite "use built-in default" with the wrong hex. */}
              <input
                type="color"
                name="accent"
                defaultValue={appearance.accent || '#e83b3b'}
                style={{ width: 60, height: 36, padding: 2, border: '1px solid var(--th-line)', borderRadius: 'var(--th-r)' }}
              />
            </Field>
            <Field label="Login heading">
              <input
                type="text"
                name="heading"
                defaultValue={branding.heading}
                placeholder="Welcome back"
                style={{ padding: 'var(--th-space-8) var(--th-space-10)', border: '1px solid var(--th-line)', borderRadius: 'var(--th-r)', fontSize: 13 }}
              />
            </Field>
            <Field label="Login subhead">
              <input
                type="text"
                name="subhead"
                defaultValue={branding.subhead}
                placeholder="Sign in to your workspace"
                style={{ padding: 'var(--th-space-8) var(--th-space-10)', border: '1px solid var(--th-line)', borderRadius: 'var(--th-r)', fontSize: 13 }}
              />
            </Field>
            <StepFooter>
              <button type="submit" className="ghost" formAction={onboardingSetStep.bind(null, 'connections')}>
                ← Back
              </button>
              <div style={{ display: 'flex', gap: 'var(--th-space-8)' }}>
                <button type="submit" className="ghost" formAction={onboardingComplete}>
                  Skip setup
                </button>
                <button type="submit">Save &amp; continue →</button>
              </div>
            </StepFooter>
          </form>
        )}

        {onboarding.step === 'finish' && (
          <>
            <h2 style={{ marginTop: 0 }}>You&apos;re all set</h2>
            <p className="muted">Therum CMS is ready to go. Everything here stays editable later from Settings or Studio.</p>
            <form action={onboardingComplete}>
              <button type="submit" style={{ width: '100%' }}>
                Go to dashboard
              </button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
