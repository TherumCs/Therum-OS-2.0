import { apiGet } from '../../../../lib/api';
import { Field, SelectField, TextInput, Toggle } from '../SettingsControls';
import { MenuEditor } from './MenuEditor';

export const dynamic = 'force-dynamic';

interface SiteSettings {
  siteName: string;
  tagline: string;
  homepageSlug: string | null;
  menu: { label: string; href: string }[] | null;
  showPageTitles?: boolean;
}
interface ContentItem {
  id: string;
  title: string;
  slug: string;
  type: string;
  status: string;
}
interface Paged<T> {
  items: T[];
}
interface CommerceSettings { currency: string; locale: string; minMarginPct: number }
interface SeoDefaults { siteName: string; siteDescription: string; siteLogo: string }

// Currencies the storefront can actually price in. A free-text box invites
// "USD " or "dollars"; the API takes a 3-letter code and rejects everything
// else, so the control should only offer valid ones.
const CURRENCIES: [string, string][] = [
  ['USD', 'US Dollar (USD)'], ['EUR', 'Euro (EUR)'], ['GBP', 'British Pound (GBP)'],
  ['CAD', 'Canadian Dollar (CAD)'], ['AUD', 'Australian Dollar (AUD)'], ['JPY', 'Japanese Yen (JPY)'],
];
const LOCALES: [string, string][] = [
  ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['fr-FR', 'French'],
  ['de-DE', 'German'], ['es-ES', 'Spanish'], ['ja-JP', 'Japanese'],
];

export default async function SiteSettingsPage() {
  const [site, content, commerce, seo] = await Promise.all([
    apiGet<SiteSettings>('/api/settings/site'),
    apiGet<Paged<ContentItem>>('/api/content?limit=100'),
    apiGet<CommerceSettings>('/api/settings/commerce').catch(() => ({ currency: 'USD', locale: 'en-US', minMarginPct: 0 })),
    apiGet<SeoDefaults>('/api/settings/seo-defaults').catch(() => ({ siteName: '', siteDescription: '', siteLogo: '' })),
  ]);
  const pages = content.items.filter((c) => c.type === 'page' && c.status === 'published');

  return (
    <section>
      <h1>Site</h1>
      <p className="muted">Identity, homepage, and navigation for the public frontend (Base Theme).</p>

      <div className="settings-group">
        <h3 className="settings-group-title">Identity</h3>
        <Field label="Site name" help="Shown in the header, page titles, and receipt emails.">
          <TextInput domain="site" field="siteName" initial={site.siteName} placeholder="Therum Site" />
        </Field>
        <Field label="Tagline" help="Shown on the auto-built landing page.">
          <TextInput domain="site" field="tagline" initial={site.tagline} placeholder="What this site is about" />
        </Field>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Homepage</h3>
        <Field
          label="Homepage"
          help={pages.length ? 'A published page served at the site root — or the auto-built landing.' : 'Publish a page first to assign it as the homepage.'}
        >
          <SelectField
            domain="site"
            field="homepageSlug"
            initial={site.homepageSlug ?? ''}
            options={[['', 'Auto landing (latest work + posts)'], ...pages.map((p): [string, string] => [p.slug, p.title])]}
          />
        </Field>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Page titles</h3>
        <div className="settings-toggle-row">
          <div className="settings-toggle-row-text">
            <span className="settings-toggle-row-label">Show the page title above content</span>
            <span className="settings-toggle-row-desc">
              Designed and ported layouts usually open with their own headline, so the CMS adding an H1 puts two titles
              on the page. This is the site-wide default — any single page can override it from its own settings.
            </span>
          </div>
          <Toggle domain="site" field="showPageTitles" initial={site.showPageTitles !== false} />
        </div>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Navigation menu</h3>
        <MenuEditor initial={site.menu} />
      </div>

      {/* CURRENCY AND LOCALE had no control anywhere. The API has always taken
          them; there was simply no way to set them without calling it by hand,
          which for a store about to go live on a domain is not a small gap. */}
      <div className="settings-group">
        <h3 className="settings-group-title">Store</h3>
        <Field label="Currency" help="What prices are stored and charged in. Changing it does not convert existing prices.">
          <SelectField domain="commerce" field="currency" initial={commerce.currency} options={CURRENCIES} />
        </Field>
        <Field label="Locale" help="How prices and dates are formatted for shoppers.">
          <SelectField domain="commerce" field="locale" initial={commerce.locale} options={LOCALES} />
        </Field>
      </div>

      {/* SEO DEFAULTS were only reachable during onboarding — set once, then
          unreachable forever. These are what a page falls back to when it has
          no title or description of its own, and what gets shared to social. */}
      <div className="settings-group">
        <h3 className="settings-group-title">Search &amp; sharing defaults</h3>
        <Field label="Default title" help="Used when a page has no SEO title of its own.">
          <TextInput domain="seo-defaults" field="siteName" initial={seo.siteName} placeholder={site.siteName} />
        </Field>
        <Field label="Default description" help="The sentence search engines and link previews show. Around 150 characters.">
          <TextInput domain="seo-defaults" field="siteDescription" initial={seo.siteDescription} placeholder="What this store sells, in one sentence." />
        </Field>
        <Field label="Share image" help="Shown when a link to this site is posted. 1200x630 works everywhere.">
          <TextInput domain="seo-defaults" field="siteLogo" initial={seo.siteLogo} placeholder="https://…/share.png" />
        </Field>
      </div>
    </section>
  );
}
