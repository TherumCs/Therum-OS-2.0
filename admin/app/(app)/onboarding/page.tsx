import type { ReactNode } from 'react';
import { apiGet } from '../../../lib/api';
import { BASE_PATH } from '../../../lib/session';
import { onboardingSetEdition, onboardingSetStep, onboardingSaveBranding, onboardingComplete, onboardingToggleAddon, onboardingToggleCapability } from '../../actions';
import { DEFAULT_LOGIN_BRANDING, type LoginBranding } from '../../../lib/loginBranding';
import { DEFAULT_APPEARANCE, type Appearance } from '../../../lib/appearance';

export const dynamic = 'force-dynamic';

interface Onboarding {
  step: 'account' | 'edition' | 'addons' | 'configure' | 'branding' | 'finish' | 'store' | 'connections';
  completed: boolean;
}
const ONBOARDING_DEFAULTS: Onboarding = { step: 'account', completed: false };

interface StudioApp { id: string; name: string; description: string; enabled: boolean; navHref?: string }
interface Capability { id: string; label?: string; name?: string; description?: string; enabled: boolean }

/** What the picker offers, whichever registry it came from. */
interface Module {
  id: string;
  kind: 'app' | 'capability';
  name: string;
  description: string;
  enabled: boolean;
  setupHref?: string;
}

// THE TWO REGISTRIES OVERLAP. Nexus is the Connections capability, Milieus is
// Memberships, Cluster is Merged Products — listing both sides would show the
// same thing twice under two names. These three are represented by their
// Studio app and skipped here.
//
// Commerce (Counter) and Content have NO Studio app, so without this they
// never appeared in setup at all: you could not choose the main thing the
// product does.
const CAPABILITY_ONLY: Record<string, { name: string; setupHref: string }> = {
  commerce: { name: 'Counter', setupHref: '/customization' },
  content: { name: 'Content', setupHref: '/pages' },
};
const COVERED_BY_APP = new Set(['connections', 'memberships', 'merged-products']);
interface Me { username: string }
interface CommerceSettings { currency: string; locale: string }

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];

interface SeoDefaults {
  siteName: string;
  siteDescription: string;
  siteLogo: string;
}
const SEO_DEFAULTS: SeoDefaults = { siteName: '', siteDescription: '', siteLogo: '' };

// 'connections' is deliberately NOT here: it was a step that told you it was
// not built yet, which is not a step. Connections exist now and live in Nexus.
const STEPS = ['account', 'edition', 'addons', 'configure', 'branding', 'finish'] as const;
const STEP_LABELS: Record<(typeof STEPS)[number], string> = {
  account: 'Account',
  edition: 'Edition',
  addons: 'Studio apps',
  configure: 'Set up',
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
  const [edition, seo, branding, appearance, studioApps, capabilities, me, commerce, site] = await Promise.all([
    apiGet<{ edition: 'pure' | 'unlocked' }>('/api/edition').catch(() => ({ edition: 'pure' as const })),
    apiGet<SeoDefaults>('/api/settings/seo-defaults').catch(() => SEO_DEFAULTS),
    apiGet<LoginBranding>('/api/settings/login-branding').catch(() => DEFAULT_LOGIN_BRANDING),
    apiGet<Appearance>('/api/settings/appearance').catch(() => DEFAULT_APPEARANCE),
    apiGet<StudioApp[]>('/api/studio-apps').catch((): StudioApp[] => []),
    apiGet<Capability[]>('/api/capabilities').catch((): Capability[] => []),
    apiGet<Me>('/api/me').catch((): Me => ({ username: 'admin' })),
    apiGet<CommerceSettings>('/api/settings/commerce').catch(() => ({ currency: 'USD', locale: 'en-US' })),
    apiGet<{ siteName: string }>('/api/settings/site').catch(() => ({ siteName: '' })),
  ]);

  // An install parked on the retired 'connections' step resumes at Studio apps
  // rather than falling off the end of the list and showing nothing.
  // Retired steps map onto live ones rather than falling off the end of the
  // list and rendering an empty card.
  const RETIRED: Record<string, (typeof STEPS)[number]> = { connections: 'addons', store: 'configure' };
  const current = (RETIRED[onboarding.step] ?? onboarding.step) as (typeof STEPS)[number];
  const stepIndex = STEPS.indexOf(current);
  // One list, both registries, deduped — see CAPABILITY_ONLY.
  const modules: Module[] = [
    ...capabilities
      .filter((c) => CAPABILITY_ONLY[c.id] && !COVERED_BY_APP.has(c.id))
      .map((c): Module => ({
        id: c.id,
        kind: 'capability',
        name: CAPABILITY_ONLY[c.id]!.name,
        description: c.description ?? '',
        enabled: c.enabled,
        setupHref: CAPABILITY_ONLY[c.id]!.setupHref,
      })),
    ...studioApps.map((a): Module => ({
      id: a.id, kind: 'app', name: a.name, description: a.description, enabled: a.enabled, setupHref: a.navHref,
    })),
  ];
  const enabledApps = modules.filter((m) => m.enabled);

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
        {current === 'edition' && (
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

        {current === 'account' && (
          <>
            <h2 style={{ marginTop: 0 }}>You&apos;re signed in as {me.username}</h2>
            <p className="muted">
              This account is the full administrator. Extra people, roles and two-factor live in Settings once you are
              through setup — nothing here is permanent.
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              Change your password or username in Settings → Security. This wizard never asks for a password.
            </p>
            <StepFooter>
              <form action={onboardingComplete}>
                <button type="submit" className="ghost">Skip setup</button>
              </form>
              <form action={onboardingSetStep.bind(null, 'edition')}>
                <button type="submit">Next →</button>
              </form>
            </StepFooter>
          </>
        )}

        {current === 'addons' && (
          <>
            <h2 style={{ marginTop: 0 }}>What is this install for?</h2>
            <p className="muted">
              Counter is the store; the rest add their own section to the sidebar. Off means the code stays installed
              and simply does not appear — turn any of them on later in Studio.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--th-space-8)' }}>
              {modules.map((a) => (
                <form
                  key={`${a.kind}-${a.id}`}
                  action={(a.kind === 'capability' ? onboardingToggleCapability : onboardingToggleAddon).bind(null, a.id, !a.enabled)}
                >
                  <button
                    type="submit"
                    className={'th-onb-app' + (a.enabled ? ' is-on' : '')}
                    aria-pressed={a.enabled}
                  >
                    <span className="th-onb-app__check" aria-hidden="true">{a.enabled ? '✓' : ''}</span>
                    <span>
                      <strong>{a.name}</strong>
                      <span className="th-hint" style={{ display: 'block' }}>{a.description}</span>
                    </span>
                  </button>
                </form>
              ))}
              {!modules.length && <p className="muted">Nothing is registered on this install.</p>}
            </div>
            <StepFooter>
              <form action={onboardingSetStep.bind(null, 'edition')}>
                <button type="submit" className="ghost">← Back</button>
              </form>
              <div style={{ display: 'flex', gap: 'var(--th-space-8)' }}>
                <form action={onboardingComplete}>
                  <button type="submit" className="ghost">Skip setup</button>
                </form>
                <form action={onboardingSetStep.bind(null, 'configure')}>
                  <button type="submit">Next →</button>
                </form>
              </div>
            </StepFooter>
          </>
        )}

        {current === 'configure' && (
          <>
            <h2 style={{ marginTop: 0 }}>Set these up now, or finish later</h2>
            <p className="muted">
              These are the apps you turned on. Each opens its own screen — none of it has to happen now, and nothing
              here blocks the rest of setup. Anything you skip is exactly where you left it, in the sidebar.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--th-space-8)' }}>
              {enabledApps.map((a) => (
                <div key={`${a.kind}-${a.id}`} className="th-onb-app" style={{ cursor: 'default' }}>
                  <span className="th-onb-app__check" aria-hidden="true">✓</span>
                  <span style={{ flex: 1 }}>
                    <strong>{a.name}</strong>
                    <span className="th-hint" style={{ display: 'block' }}>{a.description}</span>
                  </span>
                  {a.setupHref && (
                    /* Opens in a new tab ON PURPOSE — sending someone out of a
                       wizard to configure something is how they lose their
                       place in it. */
                    <a
                      className="th-btn th-btn--xs"
                      href={`${BASE_PATH}${a.setupHref}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ flex: '0 0 auto', alignSelf: 'center' }}
                    >
                      Set up ↗
                    </a>
                  )}
                </div>
              ))}
              {!enabledApps.length && (
                <p className="muted">
                  You did not turn any Studio apps on. That is a perfectly good answer — you can add them later from
                  Studio.
                </p>
              )}
            </div>
            <StepFooter>
              <form action={onboardingSetStep.bind(null, 'addons')}>
                <button type="submit" className="ghost">← Back</button>
              </form>
              <div style={{ display: 'flex', gap: 'var(--th-space-8)' }}>
                <form action={onboardingComplete}>
                  <button type="submit" className="ghost">Skip setup</button>
                </form>
                <form action={onboardingSetStep.bind(null, 'branding')}>
                  <button type="submit">{enabledApps.length ? 'Finish these later →' : 'Next →'}</button>
                </form>
              </div>
            </StepFooter>
          </>
        )}

        {current === 'branding' && (
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

        {current === 'finish' && (
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
