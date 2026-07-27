import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../../lib/db.js';
import { contentService } from '../../services/content.service.js';
import { settingsService } from '../../services/settings.service.js';
import { capabilityService } from '../../services/capability.service.js';
import { sitePage, type NavItem } from '../../site/siteHtml.js';
import { esc } from '../../site/storefrontHtml.js';

// Base Theme routes — the default public frontend. Published content only
// (contentService.getBySlug/renderBySlug already 404 anything unpublished).
// URL scheme: pages at /:slug, posts under /blog, case studies under /work,
// homepage at / (settings.site.homepageSlug, else a landing built from
// what's published). Content pages carry the CMS's own metaTags + JSON-LD.

const PAGE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'";

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
  chromeHeader?: string;
  chromeFooter?: string;
  chromeCssUrl?: string;
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

async function buildNav(current: string): Promise<{ siteName: string; tagline: string; homepageSlug: string | null; nav: NavItem[]; chrome: ChromeCtx }> {
  const site = await settingsService.getSite();
  const chrome = await loadChrome(site);
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
  return { siteName: site.siteName, tagline: site.tagline, homepageSlug: site.homepageSlug, chrome, nav };
}

function bareOrArticle(ctx: { chrome: ChromeCtx }, r: { title: string; html: string; publishedAt: Date | string | null; type: string }, showMeta: boolean): string {
  // Ported full-bleed layouts carry their own headings/spacing — no article shell.
  if (ctx.chrome.chromeHeader || ctx.chrome.chromeFooter) return r.html;
  return contentBody(r, showMeta);
}

function contentBody(r: { title: string; html: string; publishedAt: Date | string | null; type: string }, showMeta: boolean): string {
  return `
  <article>
    <h1 class="page-title">${esc(r.title)}</h1>
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
  const notFound = async (reply: FastifyReply, path: string): Promise<void> => {
    const ctx = await buildNav(path);
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
    const ctx = await buildNav('/');
    if (ctx.homepageSlug) {
      try {
        const r = await contentService.renderBySlug(ctx.homepageSlug, originOf(req));
        return send(reply, sitePage({
          ...ctx.chrome,
          title: `${r.title} — ${ctx.siteName}`,
          headExtra: headExtraFor(r),
          siteName: ctx.siteName,
          nav: ctx.nav,
          body: bareOrArticle(ctx, r, false),
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
  app.get('/blog', async (_req, reply) => {
    const ctx = await buildNav('/blog');
    send(reply, sitePage({ ...ctx.chrome, title: `Blog — ${ctx.siteName}`, siteName: ctx.siteName, nav: ctx.nav, body: `<h1 class="page-title">Blog</h1>${await indexCards('post', '/blog')}` }));
  });

  app.get('/blog/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    try {
      // origin carries the section prefix so canonical/og:url match the URL
      // actually served (posts live under /blog, not at the root).
      const r = await contentService.renderBySlug(slug, `${originOf(req)}/blog`);
      if (r.type !== 'post') return notFound(reply, `/blog/${slug}`);
      const ctx = await buildNav('/blog');
      send(reply, sitePage({ ...ctx.chrome, title: `${r.title} — ${ctx.siteName}`, headExtra: headExtraFor(r), siteName: ctx.siteName, nav: ctx.nav, body: bareOrArticle(ctx, r, true) }));
    } catch {
      return notFound(reply, `/blog/${slug}`);
    }
  });

  // ── /work + /work/:slug — Case Studies (Portfolio) ──
  app.get('/work', async (_req, reply) => {
    const ctx = await buildNav('/work');
    send(reply, sitePage({ ...ctx.chrome, title: `Work — ${ctx.siteName}`, siteName: ctx.siteName, nav: ctx.nav, body: `<h1 class="page-title">Work</h1>${await indexCards('case_study', '/work')}` }));
  });

  app.get('/work/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    try {
      const r = await contentService.renderBySlug(slug, `${originOf(req)}/work`);
      if (r.type !== 'case_study') return notFound(reply, `/work/${slug}`);
      const ctx = await buildNav('/work');
      send(reply, sitePage({ ...ctx.chrome, title: `${r.title} — ${ctx.siteName}`, headExtra: headExtraFor(r), siteName: ctx.siteName, nav: ctx.nav, body: bareOrArticle(ctx, r, true) }));
    } catch {
      return notFound(reply, `/work/${slug}`);
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
      if (r.type !== 'page') return notFound(reply, `/${slug}`);
      const ctx = await buildNav(`/${slug}`);
      send(reply, sitePage({ ...ctx.chrome, title: `${r.title} — ${ctx.siteName}`, headExtra: headExtraFor(r), siteName: ctx.siteName, nav: ctx.nav, body: bareOrArticle(ctx, r, false) }));
    } catch {
      return notFound(reply, `/${slug}`);
    }
  });
}
