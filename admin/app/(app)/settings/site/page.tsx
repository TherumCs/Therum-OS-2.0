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

export default async function SiteSettingsPage() {
  const [site, content] = await Promise.all([
    apiGet<SiteSettings>('/api/settings/site'),
    apiGet<Paged<ContentItem>>('/api/content?limit=100'),
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
    </section>
  );
}
