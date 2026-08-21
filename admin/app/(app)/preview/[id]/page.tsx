import type { Metadata } from 'next';
import { apiGet, forwardedOriginHeaders } from '../../../../lib/api';

export const dynamic = 'force-dynamic';

interface ResolvedSeo {
  title: string;
  description: string;
  image: string;
  canonical: string;
  noindex: boolean;
  type: 'article' | 'website';
}

interface RenderResult {
  title: string;
  slug: string;
  html: string;
  seo?: { title?: string; description?: string };
  resolvedSeo?: ResolvedSeo;
  jsonLd?: object;
  type: string;
  status: string;
  publishedAt: string | null;
}

// Two separate fetches (here + in the page body below) rather than sharing
// one — apiGet() forces cache:'no-store', so there's nothing for Next's
// request memoization to dedupe anyway. Both hit a fast local API; not
// worth restructuring the page around a shared-data pattern for that.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const { id } = await params;
    const data = await apiGet<RenderResult>(`/api/content/${id}/render`, await forwardedOriginHeaders());
    const seo = data.resolvedSeo;
    if (!seo) return {};
    return {
      title: seo.title,
      description: seo.description,
      robots: seo.noindex ? { index: false, follow: false } : undefined,
      alternates: { canonical: seo.canonical },
      openGraph: {
        title: seo.title,
        description: seo.description,
        url: seo.canonical,
        type: seo.type,
        images: seo.image ? [{ url: seo.image, width: 1200, height: 630 }] : undefined,
      },
      twitter: {
        card: 'summary_large_image',
        title: seo.title,
        description: seo.description,
        images: seo.image ? [seo.image] : undefined,
      },
    };
  } catch {
    return {};
  }
}

// Serves both "Preview" and "View live" from ContentCard — there's no
// separate public theme/renderer built yet (see PROGRESS.md: "no public
// storefront built yet"), so this is the one honest destination for either
// link today: an admin-authenticated render of whatever the content actually
// is right now, any status. Reached with `?embed=1` so (app)/layout.tsx
// bare-renders it (no sidebar/topbar) — the same escape hatch Desktop Mode's
// windowed iframes already use.
//
// The real meta tags above (via generateMetadata, Next's actual metadata
// API) and the JSON-LD below are genuinely correct HTML — they just aren't
// reachable by a real crawler yet since this whole page sits behind login.
export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data: RenderResult | null = null;
  let err: string | null = null;
  try {
    data = await apiGet<RenderResult>(`/api/content/${id}/render`, await forwardedOriginHeaders());
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  if (err || !data) {
    return (
      <div className="th-preview">
        <div className="th-preview-banner">Couldn't load preview{err ? ` (${err})` : ''}</div>
      </div>
    );
  }

  const isLive = data.status === 'published';
  // <-escape `<` so a title/description containing literal "</script>"
  // can't break out of the script tag — JSON.stringify doesn't escape this
  // by default (the JS equivalent of 1.9.44's JSON_HEX_TAG flag).
  const jsonLdString = data.jsonLd ? JSON.stringify(data.jsonLd).replace(/</g, '\\u003c') : null;

  return (
    <div className="th-preview">
      <div className={'th-preview-banner' + (isLive ? ' is-live' : '')}>
        <span>{isLive ? 'Published — this is live' : 'Draft — preview only, not public'}</span>
        <span className="th-preview-title">{data.title || '(untitled)'}</span>
      </div>
      <div
        className="th-preview-frame"
        dangerouslySetInnerHTML={{ __html: data.html || '<p style="padding:40px;color:#888;font:14px system-ui">Nothing to render yet — this content has no body.</p>' }}
      />
      {jsonLdString && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString }} />}
    </div>
  );
}
