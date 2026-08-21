import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PAGE_CSP } from '../../site/pageCsp.js';
import { db } from '../../lib/db.js';
import { contentService } from '../../services/content.service.js';
import { settingsService, type SiteSettings } from '../../services/settings.service.js';
import { capabilityService } from '../../services/capability.service.js';
import { dockMarkup, dockScript, dockStyles } from '../../site/adminDock.js';
import { walletPayments } from '../../counter/walletPayments.js';
import { sitePage, type NavItem } from '../../site/siteHtml.js';
import type { HeaderCartConfig } from '../../site/headerCart.js';
import { esc } from '../../site/html.js';
import { adminSessionFrom } from '../../lib/adminSession.js';

// Base Theme routes — the default public frontend. Published content only
// (contentService.getBySlug/renderBySlug already 404 anything unpublished).
// URL scheme: pages at /:slug, posts under /blog, case studies under /work,
// homepage at / (settings.site.homepageSlug, else a landing built from
// what's published). Content pages carry the CMS's own metaTags + JSON-LD.



function send(reply: FastifyReply, body: string, status = 200): void {
  reply.status(status).header('content-security-policy', PAGE_CSP).type('text/html; charset=utf-8').send(body);
}

function originOf(req: FastifyRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
  return `${proto}://${req.headers.host ?? 'localhost'}`;
}

const fmtDate = (d: Date | string | null): string =>
  d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';

export interface ChromeCtx {
  /** Front-end admin dock, present only for a signed-in admin. */
  dock?: { markup: string; styles: string; script: string };
  /** Settings > Performance, applied to the delivered HTML. */
  perf?: { lazyImages: boolean; minHtml: boolean; minCss: boolean };
  /** Settings > Security — false removes the platform credit. */
  showPlatformCredit?: boolean;
  chromeHeader?: string;
  chromeFooter?: string;
  chromeCssUrl?: string;
  /** Settings > Counter — how the header's icons behave. */
  headerIcons?: HeaderCartConfig;
}

// WP Bridge chrome: published content rendered as the site header/footer
// (settings.site.chromeHeaderSlug/chromeFooterSlug) + the ported stylesheet.
async function loadChrome(site: { chromeHeaderSlug: string | null; chromeFooterSlug: string | null; chromeCssUrl: string | null }): Promise<ChromeCtx> {
  const out: ChromeCtx = {};
  if (site.chromeCssUrl) out.chromeCssUrl = site.chromeCssUrl;
  for (const [slug, key] of [[site.chromeHeaderSlug, 'chromeHeader'], [site.chromeFooterSlug, 'chromeFooter']] as const) {
    if (!slug) continue;
    try {
      const r = await contentService.renderBySlug(slug, 'http://localhost');
      (out as Record<string, string>)[key] = r.html;
    } catch {
      /* chrome content unpublished/missing — fall back to Base Theme chrome */
    }
  }
  return out;
}

// Builds the front-end admin dock for one request, or null when the caller is
// not a signed-in admin. Kept out of buildNav so the auth failure paths read
// in one place.
async function buildDock(req: FastifyRequest, current: string): Promise<{ markup: string; styles: string; script: string } | null> {
  const session = adminSessionFrom(req);
  if (!session) return null;
  const userId = session.sub;
  // The token carries only `sub` (a cuid), so the avatar initial has to come
  // from the account itself — falling back to sub put a "C" on every avatar,
  // the first letter of the id rather than of the name.
  const account = await db.adminUser.findUnique({ where: { id: userId }, select: { username: true } });
  if (!account) return null;
  const username = account.username;

  const settings = await settingsService.getAdminDock();
  const slug = current.replace(/^\//, '').split('?')[0] ?? '';
  const row = slug ? await db.content.findFirst({ where: { slug }, select: { id: true, title: true } }) : null;
  // A real content row names itself; index routes (/blog, /work) have no row,
  // so title-case the path rather than mislabelling everything "Home".
  const fallbackCrumb = slug
    ? slug.split('/')[0]!.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Home';
  return {
    markup: dockMarkup({
      crumb: row?.title ?? fallbackCrumb,
      // Hands off through the admin so the session token stays out of
      // this page's HTML — see admin/app/edit/[id]/route.ts.
      editUrl: row ? `/tos-admin/edit/${row.id}` : null,
      username,
      settings,
    }),
    styles: dockStyles(),
    script: dockScript(),
  };
}

export async function buildNav(current: string, req?: FastifyRequest): Promise<{ siteName: string; tagline: string; homepageSlug: string | null; nav: NavItem[]; chrome: ChromeCtx; site: SiteSettings }> {
  const site = await settingsService.getSite();
  const chrome = await loadChrome(site);
  // The admin dock rides along in `chrome` because every sitePage() call site
  // already spreads it — one place to add it, no route left behind. Only ever
  // built for a request carrying a valid admin session, so a logged-out
  // visitor gets byte-identical HTML.
  const dock = req ? await buildDock(req, current) : undefined;
  if (dock) (chrome as ChromeCtx & { dock?: unknown }).dock = dock;
  const stealth = await settingsService.getStealth();
  (chrome as ChromeCtx & { showPlatformCredit?: boolean }).showPlatformCredit = !stealth.hidePlatformCredit;
  const perf = await settingsService.getPerformance();
  (chrome as ChromeCtx & { perf?: unknown }).perf = {
    lazyImages: perf.lazyImages,
    minHtml: perf.minHtml,
    minCss: perf.minCss,
  };
  const counterSettings = await settingsService.getCounter();
  chrome.headerIcons = {
    cartStyle: counterSettings.cartStyle,
    cartSidebarReveal: counterSettings.cartSidebarReveal,
    cartMobile: counterSettings.cartMobile,
    cartSidebarGround: counterSettings.cartSidebarGround,
    searchStyle: counterSettings.searchStyle,
    searchLayout: counterSettings.searchLayout,
    wishlistEnabled: counterSettings.wishlistEnabled,
  };
  const [pages, postCount, workCount, commerce] = await Promise.all([
    db.content.findMany({ where: { type: 'page', status: 'published' }, select: { slug: true, title: true }, orderBy: { createdAt: 'asc' }, take: 6 }),
    db.content.count({ where: { type: 'post', status: 'published' } }),
    db.content.count({ where: { type: 'case_study', status: 'published' } }),
    capabilityService.isEnabled('commerce'),
  ]);
  // A stored custom menu (Settings → Site) wins outright; auto-build is the
  // zero-config fallback.
  if (site.menu && site.menu.length) {
    return {
      siteName: site.siteName,
      tagline: site.tagline,
      homepageSlug: site.homepageSlug,
      site,
      chrome,
      nav: site.menu.map((m) => ({ href: m.href, label: m.label, current: current === m.href || (m.href !== '/' && current.startsWith(m.href)) })),
    };
  }
  const nav: NavItem[] = [];
  for (const p of pages) {
    if (p.slug === site.homepageSlug) continue; // homepage rides the brand link
    if (p.slug === site.chromeHeaderSlug || p.slug === site.chromeFooterSlug) continue; // chrome content isn't a nav page
    nav.push({ href: `/${p.slug}`, label: p.title, current: current === `/${p.slug}` });
  }
  if (postCount > 0) nav.push({ href: '/blog', label: 'Blog', current: current.startsWith('/blog') });
  if (workCount > 0) nav.push({ href: '/work', label: 'Work', current: current.startsWith('/work') });
  if (commerce) nav.push({ href: '/shop', label: 'Shop' });
  return { siteName: site.siteName, tagline: site.tagline, homepageSlug: site.homepageSlug, chrome, nav, site };
}


/**
 * Head metadata for a LISTING page (/blog, /work).
 *
 * Individual posts get this from contentService.renderBySlug via headExtraFor;
 * the indexes were passing nothing, so they had no description, no canonical
 * and no og: tags at all. A listing is usually the page that ranks, so it is
 * the last one that should be bare.
 */
function listingHead(req: FastifyRequest, path: string, title: string, description: string): string {
  const url = `${originOf(req)}${path}`;
  return [
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    '<meta property="og:type" content="website">',
    '<meta name="twitter:card" content="summary">',
  ].join('\n');
}

/**
 * Whether to print the H1 above a page's content.
 *
 * Two levels, because they answer different questions. The SITE setting is the
 * default for a whole install; a PAGE can override it either way via
 * `meta.hideTitle`. A designed or ported layout usually opens with its own
 * headline, and the CMS stacking a second one on top is the actual complaint —
 * but that is a per-page fact, so a site-wide switch alone would be too blunt.
 */
function showTitle(site: { showPageTitles?: boolean }, meta: unknown): boolean {
  const pageOverride = (meta as { hideTitle?: unknown } | null)?.hideTitle;
  if (typeof pageOverride === 'boolean') return !pageOverride;
  return site.showPageTitles !== false;
}

/**
 * Page-scoped CSS from `content.meta.css`, validated on the way out.
 *
 * `meta` is free-form JSON that an import or an API caller can write anything
 * into, and this string lands inside a <style> tag — so a `</style>` in it
 * would break out into markup. Rejected rather than escaped: CSS has no
 * legitimate use for that sequence, and silently mangling a stylesheet is
 * worse than not applying it.
 */
function pageCssOf(meta: unknown): string | undefined {
  const css = (meta as { css?: unknown } | null)?.css;
  if (typeof css !== 'string' || !css.trim()) return undefined;
  if (/<\/style/i.test(css)) return undefined;
  return css.slice(0, 200_000);
}

function bareOrArticle(
  ctx: { chrome: ChromeCtx },
  r: { title: string; html: string; publishedAt: Date | string | null; type: string; meta?: unknown },
  showMeta: boolean,
  withTitle = true,
): string {
  // Ported full-bleed layouts carry their own headings/spacing — no article shell.
  if (ctx.chrome.chromeHeader || ctx.chrome.chromeFooter) {
    // ...except that several of them do NOT carry an h1. The policy pages and
    // the FAQ open straight at h2, and the homepage's headline is a styled div,
    // so those pages had no top-level heading at all — the document had no name
    // for a screen reader or a crawler. Where the page really is missing one,
    // add it from the title and hide it visually, so the design is untouched.
    if (!/<h1[\s>]/i.test(r.html)) {
      return `<h1 class="th-sr-only">${esc(r.title)}</h1>${r.html}`;
    }
    return r.html;
  }
  return contentBody(r, showMeta, withTitle);
}

function contentBody(r: { title: string; html: string; publishedAt: Date | string | null; type: string }, showMeta: boolean, withTitle = true): string {
  return `
  <article>
    ${withTitle ? `<h1 class="page-title">${esc(r.title)}</h1>` : ''}
    ${showMeta && r.publishedAt ? `<p class="page-meta">${esc(fmtDate(r.publishedAt))}</p>` : ''}
    <div class="prose">${r.html}</div>
  </article>`;
}

function headExtraFor(r: { metaTags: string; jsonLd: unknown }): string {
  const jsonLd = r.jsonLd ? `<script type="application/ld+json">${JSON.stringify(r.jsonLd).replace(/</g, '\\u003c')}</script>` : '';
  return `${r.metaTags}\n${jsonLd}`;
}

async function indexCards(type: 'post' | 'case_study', base: string): Promise<string> {
  const items = await db.content.findMany({
    where: { type, status: 'published' },
    select: { slug: true, title: true, excerpt: true, publishedAt: true },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    take: 50,
  });
  if (!items.length) return '<p class="empty">Nothing published yet.</p>';
  return `<div class="cards">${items.map((i) => `
    <a class="card" href="${base}/${esc(i.slug)}">
      <div class="t">${esc(i.title)}</div>
      ${i.excerpt ? `<div class="x">${esc(i.excerpt)}</div>` : ''}
      ${i.publishedAt ? `<div class="d">${esc(fmtDate(i.publishedAt))}</div>` : ''}
    </a>`).join('')}</div>`;
}

export async function siteRoutes(app: FastifyInstance): Promise<void> {
  // A favicon, so every page load stops 404ing for one. Uses the site logo
  // when SEO defaults carry one; otherwise a tiny generated mark rather than
  // a missing file, because browsers request this on every single page.
  app.get('/favicon.ico', async (_req, reply) => {
    const seo = await settingsService.getSeoDefaults().catch(() => ({ siteLogo: '' }));
    if (seo.siteLogo) return reply.redirect(seo.siteLogo, 302);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
      '<rect width="32" height="32" rx="6" fill="#0a0a0a"/>' +
      '<circle cx="16" cy="16" r="6" fill="#e83b3b"/></svg>';
    reply.header('content-type', 'image/svg+xml').header('cache-control', 'public, max-age=86400').send(svg);
  });

  // Apple Pay domain verification. Apple fetches this exact path over HTTPS on
  // the host serving checkout and will not render the button if it 404s — the
  // single most common reason "Apple Pay just doesn't show up". Served from
  // Settings > Payments so it can be pasted in rather than deployed.
  app.get('/.well-known/apple-developer-merchantid-domain-association', async (_req, reply) => {
    const body = await walletPayments.appleDomainAssociation();
    reply.type('text/plain').send(body);
  });

  // robots.txt + sitemap.xml — the live store had NEITHER (both 404'd), so
  // search engines had no crawl directives and no page index.
  app.get('/robots.txt', async (req, reply) => {
    reply.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /tos-admin\nDisallow: /api\nSitemap: ${originOf(req)}/sitemap.xml\n`);
  });
  app.get('/sitemap.xml', async (req, reply) => {
    const origin = originOf(req);
    const [content, products] = await Promise.all([
      db.content.findMany({ where: { status: 'published' }, select: { slug: true, type: true, updatedAt: true } }),
      db.product.findMany({ where: { status: 'active', visibility: 'public', deletedAt: null }, select: { slug: true, updatedAt: true } }),
    ]);
    const urls: { loc: string; lastmod?: Date }[] = [{ loc: `${origin}/` }, { loc: `${origin}/shop` }];
    for (const c of content) {
      const path = c.type === 'post' ? `/blog/${c.slug}` : c.type === 'case_study' ? `/work/${c.slug}` : `/${c.slug}`;
      urls.push({ loc: `${origin}${path}`, lastmod: c.updatedAt });
    }
    for (const p of products) urls.push({ loc: `${origin}/product/${p.slug}`, lastmod: p.updatedAt });
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}</url>`).join('\n')
      + '\n</urlset>';
    reply.type('application/xml').send(xml);
  });


  const notFound = async (reply: FastifyReply, path: string, req?: FastifyRequest): Promise<void> => {
    const ctx = await buildNav(path, req);
    send(reply, sitePage({
      ...ctx.chrome,
      title: `Not found — ${ctx.siteName}`,
      siteName: ctx.siteName,
      nav: ctx.nav,
      body: '<div class="empty"><h1 class="page-title">Page not found</h1><p>That link doesn\'t go anywhere — <a href="/" style="color:var(--ac-btn)">head home</a>.</p></div>',
    }), 404);
  };

  // ── / — homepage: the configured page, else a landing from what exists ──
  app.get('/', async (req, reply) => {
    const ctx = await buildNav('/', req);
    if (ctx.homepageSlug) {
      try {
        const r = await contentService.renderBySlug(ctx.homepageSlug, originOf(req), `${originOf(req)}/`);
        return send(reply, sitePage({
          ...ctx.chrome,
          title: `${r.title} — ${ctx.siteName}`,
          headExtra: headExtraFor(r),
          siteName: ctx.siteName,
          nav: ctx.nav,
          body: bareOrArticle(ctx, r, false, showTitle(ctx.site, r.meta)), pageCss: pageCssOf(r.meta),
        }));
      } catch {
        // configured homepage unpublished/deleted — fall through to landing
      }
    }
    const [posts, work] = await Promise.all([indexCards('post', '/blog'), indexCards('case_study', '/work')]);
    const hasPosts = !posts.includes('empty');
    const hasWork = !work.includes('empty');
    send(reply, sitePage({
      ...ctx.chrome,
      title: ctx.siteName,
      siteName: ctx.siteName,
      nav: ctx.nav,
      body: `
        <h1 class="page-title">${esc(ctx.siteName)}</h1>
        ${ctx.tagline ? `<p class="tagline">${esc(ctx.tagline)}</p>` : ''}
        ${hasWork ? `<p class="section-label">Work</p>${work}` : ''}
        ${hasPosts ? `<p class="section-label">Latest posts</p>${posts}` : ''}
        ${!hasPosts && !hasWork ? '<p class="empty">Nothing published yet — set a homepage in Settings → Site or publish a page.</p>' : ''}`,
    }));
  });

  // ── /blog + /blog/:slug ──
  // NOT gated on having posts, unlike /work. The homepage's editorial cards
  // link here, so 404ing an empty blog turns the front page into a dead end —
  // and unlike case studies, posts ARE coming to this site. An empty index with
  // its own empty state is the honest interim.
  app.get('/blog', async (req, reply) => {
    const ctx = await buildNav('/blog', req);
    send(reply, sitePage({ ...ctx.chrome, title: `Blog — ${ctx.siteName}`,
      headExtra: listingHead(req, '/blog', `Blog — ${ctx.siteName}`, `News, drops and writing from ${ctx.siteName}.`),
      siteName: ctx.siteName, nav: ctx.nav, body: `<h1 class="page-title">Blog</h1>${await indexCards('post', '/blog')}` }));
  });

  app.get('/blog/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    // A trailing slash lands HERE, not on /blog — '/blog/' matches this route
    // with an empty slug, which then looked up a post named '' and 404ed. Every
    // other page on the site tolerates the slash, so a link written the normal
    // way hit a dead page.
    //
    // 301 to the canonical /blog rather than rendering the index at both URLs:
    // two addresses serving identical content split their own ranking, and the
    // homepage's editorial cards already point at /blog.
    if (!slug) return reply.redirect('/blog', 301);
    try {
      // origin carries the section prefix so canonical/og:url match the URL
      // actually served (posts live under /blog, not at the root).
      const r = await contentService.renderBySlug(slug, `${originOf(req)}/blog`);
      if (r.type !== 'post') return notFound(reply, `/blog/${slug}`, req);
      const ctx = await buildNav('/blog', req);
      send(reply, sitePage({ ...ctx.chrome, title: `${r.title} — ${ctx.siteName}`, headExtra: headExtraFor(r), siteName: ctx.siteName, nav: ctx.nav, body: bareOrArticle(ctx, r, true, showTitle(ctx.site, r.meta)), pageCss: pageCssOf(r.meta) }));
    } catch {
      return notFound(reply, `/blog/${slug}`, req);
    }
  });

  // ── /work + /work/:slug — Case Studies (Portfolio) ──
  app.get('/work', async (req, reply) => {
    // No published case studies means the section does not exist on this site.
    // An empty index is a dead page: it is crawlable, it ranks for nothing, and
    // it invites a visitor to click into an empty room. The route and the
    // renderer stay — publish a case study and the section comes back on its
    // own, no code change.
    if ((await db.content.count({ where: { type: 'case_study', status: 'published' } })) === 0) {
      return notFound(reply, '/work', req);
    }
    const ctx = await buildNav('/work', req);
    send(reply, sitePage({ ...ctx.chrome, title: `Work — ${ctx.siteName}`,
      headExtra: listingHead(req, '/work', `Work — ${ctx.siteName}`, `Selected projects and case studies from ${ctx.siteName}.`),
      siteName: ctx.siteName, nav: ctx.nav, body: `<h1 class="page-title">Work</h1>${await indexCards('case_study', '/work')}` }));
  });

  app.get('/work/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    try {
      const r = await contentService.renderBySlug(slug, `${originOf(req)}/work`);
      if (r.type !== 'case_study') return notFound(reply, `/work/${slug}`, req);
      const ctx = await buildNav('/work', req);
      send(reply, sitePage({ ...ctx.chrome, title: `${r.title} — ${ctx.siteName}`, headExtra: headExtraFor(r), siteName: ctx.siteName, nav: ctx.nav, body: bareOrArticle(ctx, r, true, showTitle(ctx.site, r.meta)), pageCss: pageCssOf(r.meta) }));
    } catch {
      return notFound(reply, `/work/${slug}`, req);
    }
  });

  // ── /:slug — pages. Registered LAST at this level; Fastify static routes
  //    (/shop, /cart, /blog, /work, /api/…) always win over the param route. ──
  app.get('/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    // Asset-ish requests (favicon.ico, robots.txt handled elsewhere/absent)
    // get a plain 404, not a themed page.
    if (slug.includes('.')) {
      reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } });
      return;
    }
    try {
      const r = await contentService.renderBySlug(slug, originOf(req));
      if (r.type !== 'page') return notFound(reply, `/${slug}`, req);
      const ctx = await buildNav(`/${slug}`, req);
      send(reply, sitePage({ ...ctx.chrome, title: `${r.title} — ${ctx.siteName}`, headExtra: headExtraFor(r), siteName: ctx.siteName, nav: ctx.nav, body: bareOrArticle(ctx, r, false, showTitle(ctx.site, r.meta)), pageCss: pageCssOf(r.meta) }));
    } catch {
      return notFound(reply, `/${slug}`, req);
    }
  });
}
