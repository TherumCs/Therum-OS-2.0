import { isCanvasNode, type CanvasNode } from './render.js';

// Zero-config auto-SEO, matching mu-plugins/therum-seo.php's fallback chains
// exactly: manual override > derived-from-content > site default. Two real
// gaps versus the source, both because the data doesn't exist in 2.0 yet
// (not silently faked): no author (Content has no author/createdBy field),
// no article:section/article:tag (no taxonomy model — confirmed absent
// during the original inventory pass).

export interface SeoOverride {
  title?: string;
  description?: string;
  ogImage?: string;
  canonical?: string;
  noindex?: boolean;
}

export interface SeoSiteDefaults {
  siteName: string;
  siteDescription: string;
  siteLogo: string;
}

export interface ContentLike {
  title: string;
  excerpt: string | null;
  coverImage: string | null;
  body: unknown;
  bodyFormat: string;
  type: string;
  seo: unknown;
  publishedAt: Date | string | null;
  updatedAt: Date | string | null;
}

function asOverride(raw: unknown): SeoOverride {
  return raw && typeof raw === 'object' ? (raw as SeoOverride) : {};
}

function extractCanvasText(node: CanvasNode, out: string[]): void {
  const p = node.props ?? {};
  if (typeof p.text === 'string') out.push(p.text);
  if (typeof p.content === 'string') out.push(p.content);
  if (typeof p.label === 'string') out.push(p.label);
  for (const child of node.children ?? []) {
    if (isCanvasNode(child)) extractCanvasText(child, out);
  }
}

function findFirstCanvasImage(node: CanvasNode): string | null {
  if (node.type === 'image' && typeof node.props?.src === 'string' && node.props.src) return node.props.src;
  for (const child of node.children ?? []) {
    if (isCanvasNode(child)) {
      const found = findFirstCanvasImage(child);
      if (found) return found;
    }
  }
  return null;
}

function plainTextFromContent(item: ContentLike): string {
  if (item.bodyFormat === 'canvas' && isCanvasNode(item.body)) {
    const parts: string[] = [];
    extractCanvasText(item.body, parts);
    return parts.join(' ');
  }
  if (typeof item.body === 'string') return item.body.replace(/<[^>]+>/g, ' ');
  return '';
}

function firstImageFromContent(item: ContentLike): string | null {
  if (item.bodyFormat === 'canvas' && isCanvasNode(item.body)) return findFirstCanvasImage(item.body);
  if (typeof item.body === 'string') {
    const m = /<img[^>]+src=["']([^"']+)["']/i.exec(item.body);
    return m?.[1] ?? null;
  }
  return null;
}

function trimWords(s: string, max: number): string {
  const words = s.trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(' ');
  return words.slice(0, max).join(' ') + '…';
}

// Priority: manual override > item title. Matches auto_title() exactly.
export function autoTitle(item: ContentLike): string {
  return asOverride(item.seo).title || item.title;
}

// Priority: manual override > excerpt > first ~155 chars of body text > site
// description. Matches auto_description() exactly.
export function autoDescription(item: ContentLike, siteDescription: string): string {
  const override = asOverride(item.seo).description;
  if (override) return override;
  if (item.excerpt) return trimWords(item.excerpt, 30);
  const text = plainTextFromContent(item).replace(/\s+/g, ' ').trim();
  if (text.length > 10) return text.slice(0, 155) + '…';
  return siteDescription;
}

// Priority: manual override > cover image > first image in body > site logo.
// Matches auto_image() exactly. allowBodyExtraction is Quick Controls'
// Content-defaults > Thumbnail source ('auto' = true, the original 1.9.44
// behavior; 'cover-only' = false, skips straight to the site logo when
// there's no explicit cover image rather than reaching into the body).
export function autoImage(item: ContentLike, siteLogo: string, allowBodyExtraction = true): string {
  const override = asOverride(item.seo).ogImage;
  if (override) return override;
  if (item.coverImage) return item.coverImage;
  if (allowBodyExtraction) {
    const fromBody = firstImageFromContent(item);
    if (fromBody) return fromBody;
  }
  return siteLogo;
}

export interface ResolvedSeo {
  title: string;
  description: string;
  image: string;
  canonical: string;
  noindex: boolean;
  type: 'article' | 'website';
}

export function resolveSeo(item: ContentLike, url: string, defaults: SeoSiteDefaults, allowBodyImageExtraction = true): ResolvedSeo {
  const override = asOverride(item.seo);
  return {
    title: autoTitle(item),
    description: autoDescription(item, defaults.siteDescription),
    image: autoImage(item, defaults.siteLogo, allowBodyImageExtraction),
    canonical: override.canonical || url,
    noindex: !!override.noindex,
    // Posts AND case studies are article-shaped: OG type article + the full
    // Article JSON-LD node (buildJsonLd keys off resolved.type). Case
    // studies gained this when the Case Studies Studio App shipped.
    type: item.type === 'post' || item.type === 'case_study' ? 'article' : 'website',
  };
}

const escHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Full <head> tag set — canonical, description, OG (+ article-specific
// published/modified time), Twitter Card, robots. Matches Therum_Auto_SEO::head()
// line for line, minus article:section/article:tag (see file header).
export function buildMetaTags(
  resolved: ResolvedSeo,
  url: string,
  siteName: string,
  dates?: { publishedAt?: Date | string | null; updatedAt?: Date | string | null },
): string {
  const lines: string[] = [];
  lines.push(`<link rel="canonical" href="${escHtml(resolved.canonical)}" />`);
  if (resolved.description) lines.push(`<meta name="description" content="${escHtml(resolved.description)}" />`);
  lines.push(`<meta property="og:type" content="${resolved.type}" />`);
  if (resolved.title) lines.push(`<meta property="og:title" content="${escHtml(resolved.title)}" />`);
  if (resolved.description) lines.push(`<meta property="og:description" content="${escHtml(resolved.description)}" />`);
  lines.push(`<meta property="og:url" content="${escHtml(url)}" />`);
  if (siteName) lines.push(`<meta property="og:site_name" content="${escHtml(siteName)}" />`);
  if (resolved.image) {
    lines.push(`<meta property="og:image" content="${escHtml(resolved.image)}" />`);
    lines.push('<meta property="og:image:width" content="1200" />');
    lines.push('<meta property="og:image:height" content="630" />');
  }
  if (resolved.type === 'article') {
    if (dates?.publishedAt) lines.push(`<meta property="article:published_time" content="${new Date(dates.publishedAt).toISOString()}" />`);
    if (dates?.updatedAt) lines.push(`<meta property="article:modified_time" content="${new Date(dates.updatedAt).toISOString()}" />`);
  }
  lines.push('<meta name="twitter:card" content="summary_large_image" />');
  if (resolved.title) lines.push(`<meta name="twitter:title" content="${escHtml(resolved.title)}" />`);
  if (resolved.description) lines.push(`<meta name="twitter:description" content="${escHtml(resolved.description)}" />`);
  if (resolved.image) lines.push(`<meta name="twitter:image" content="${escHtml(resolved.image)}" />`);
  if (resolved.noindex) lines.push('<meta name="robots" content="noindex,nofollow" />');
  return lines.join('\n');
}

// WebSite + Organization + (Article|WebPage) + BreadcrumbList graph, cross-
// referenced by @id exactly like Therum_Auto_SEO::json_ld(). No `author` node
// (Content has no author/createdBy field to draw one from).
export function buildJsonLd(item: ContentLike, resolved: ResolvedSeo, url: string, siteOrigin: string, siteName: string): object {
  const graph: Record<string, unknown>[] = [
    {
      '@type': 'WebSite',
      '@id': `${siteOrigin}/#website`,
      url: siteOrigin,
      name: siteName,
      potentialAction: {
        '@type': 'SearchAction',
        target: `${siteOrigin}/?s={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'Organization',
      '@id': `${siteOrigin}/#org`,
      name: siteName,
      url: siteOrigin,
      logo: resolved.image || `${siteOrigin}/favicon.ico`,
    },
  ];

  if (resolved.type === 'article') {
    const words = plainTextFromContent(item).split(/\s+/).filter(Boolean).length;
    graph.push({
      '@type': 'Article',
      '@id': `${url}#article`,
      url,
      headline: resolved.title,
      description: resolved.description,
      datePublished: item.publishedAt ? new Date(item.publishedAt).toISOString() : undefined,
      dateModified: item.updatedAt ? new Date(item.updatedAt).toISOString() : undefined,
      image: resolved.image || undefined,
      publisher: { '@id': `${siteOrigin}/#org` },
      isPartOf: { '@id': `${siteOrigin}/#website` },
      mainEntityOfPage: url,
      wordCount: words > 0 ? words : undefined,
    });
  } else {
    graph.push({
      '@type': 'WebPage',
      url,
      name: resolved.title,
      description: resolved.description,
      isPartOf: { '@id': `${siteOrigin}/#website` },
      primaryImageOfPage: resolved.image ? { '@type': 'ImageObject', url: resolved.image } : undefined,
    });
  }

  // Two-level breadcrumb (Home → title) — 1.9.44 also inserts the content
  // type's archive link here; 2.0 has no archive-page concept yet.
  graph.push({
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteOrigin },
      { '@type': 'ListItem', position: 2, name: resolved.title },
    ],
  });

  return { '@context': 'https://schema.org', '@graph': graph };
}

// Derives alt text from a filename when none was set — strips the upload-
// time uuid prefix, separators, and camera-generated numeric runs. Matches
// Therum_Auto_SEO::auto_alt()'s filename branch (the title branch doesn't
// apply here: MediaAsset has no separate title field, only alt).
export function autoAltFromFilename(storedFilename: string): string {
  const base = storedFilename.replace(/\.[^.]+$/, '').replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '');
  const spaced = base.replace(/[-_]+/g, ' ').replace(/\d{2,}/g, '');
  const collapsed = spaced.replace(/\s+/g, ' ').trim();
  return collapsed ? collapsed.charAt(0).toUpperCase() + collapsed.slice(1) : '';
}
