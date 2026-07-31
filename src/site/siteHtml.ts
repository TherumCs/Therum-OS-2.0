import { BANNER_RUNTIME, BANNER_STYLES } from './bannerRuntime.js';
import { HEADER_CART_CSS, headerCartRuntime, HEADER_CART_DEFAULTS, type HeaderCartConfig } from './headerCart.js';
// Base Theme — the default public frontend shell. Deliberately minimal
// (Bam: "default theme so stuff is just popping up"; the full theme system
// is on the future-buildout list). Same real-1.9.44 token values as the
// storefront so the whole public surface reads as one site. Server-rendered,
// zero client JS except the cart badge when commerce is on.

import { esc } from './storefrontHtml.js';

const CSS = `
:root{
  --ac:#e83b3b;--ac-btn:#3858e9;--ac-btn-h:#2e45c5;
  --sf:#ffffff;--sf2:#f5f5f5;--bd:rgba(0,0,0,0.08);--bd2:rgba(0,0,0,0.16);
  --bg:#fafafa;--tx:#0a0a0a;--tx2:#666666;--tx3:#999999;
  --f:-apple-system,BlinkMacSystemFont,'Inter','Helvetica Neue',Arial,sans-serif;
  --e:0.15s ease;--radius-md:10px;--radius-lg:14px;--radius-pill:999px;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--f);background:var(--bg);color:var(--tx);line-height:1.65;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.wrap{max-width:840px;margin:0 auto;padding:0 24px}
header.site{background:var(--sf);border-bottom:1px solid var(--bd);position:sticky;top:0;z-index:10}
header.site .wrap{display:flex;align-items:center;justify-content:space-between;height:64px;max-width:1080px}
.brand{font-weight:700;font-size:17px;letter-spacing:-0.01em;display:flex;align-items:center;gap:10px}
.brand .dot{width:10px;height:10px;border-radius:50%;background:var(--ac);display:inline-block}
nav.main{display:flex;gap:22px;font-size:14px;color:var(--tx2);align-items:center;flex-wrap:wrap}
nav.main a:hover{color:var(--tx)}
nav.main a.current{color:var(--tx);font-weight:600}
main{padding:48px 0 90px}
/* Ported layouts manage their own top spacing — the Base Theme's 48px sat
   under the nav as an unexplained white gap above the hero. */
main#brx-content{padding-top:0}
.page-title{font-size:32px;font-weight:700;letter-spacing:-0.02em;line-height:1.2;margin-bottom:10px;text-wrap:balance}
.page-meta{color:var(--tx3);font-size:13px;margin-bottom:32px}
.tagline{color:var(--tx2);font-size:16px;margin-bottom:36px}
/* Prose — rendered content body */
.prose{font-size:16px;color:var(--tx)}
.prose h1,.prose h2,.prose h3{letter-spacing:-0.01em;margin:1.6em 0 .5em;line-height:1.25;text-wrap:balance}
.prose h1{font-size:28px}.prose h2{font-size:22px}.prose h3{font-size:18px}
.prose p{margin:0 0 1.1em}
.prose ul,.prose ol{margin:0 0 1.1em 1.4em}
.prose li{margin-bottom:.35em}
.prose a{color:var(--ac-btn);font-weight:500}
.prose a:hover{text-decoration:underline}
.prose img{max-width:100%;border-radius:var(--radius-lg)}
.prose blockquote{border-left:3px solid var(--bd2);padding-left:16px;color:var(--tx2);margin:0 0 1.1em}
.prose pre{background:#111;color:#eee;border-radius:var(--radius-md);padding:16px;overflow-x:auto;font-size:13px;margin:0 0 1.1em}
.prose code{font-size:.92em}
.prose hr{border:0;border-top:1px solid var(--bd);margin:2em 0}
/* Index cards (blog/work/landing) */
.cards{display:flex;flex-direction:column;gap:14px}
.card{display:block;background:var(--sf);border:1px solid var(--bd);border-radius:var(--radius-lg);padding:22px 24px;transition:border-color var(--e),transform var(--e)}
.card:hover{border-color:var(--bd2);transform:translateY(-1px)}
.card .t{font-weight:700;font-size:17px;letter-spacing:-0.01em}
.card .x{color:var(--tx2);font-size:14px;margin-top:4px}
.card .d{color:var(--tx3);font-size:12px;margin-top:8px}
.section-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--tx3);margin:40px 0 14px}
.empty{color:var(--tx3);text-align:center;padding:60px 0}
footer.site{border-top:1px solid var(--bd);padding:28px 0;color:var(--tx3);font-size:13px}
footer.site .wrap{max-width:1080px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
`;

/**
 * Shared layout for the PORTED DOCUMENT pages — FAQ, About, and the policy
 * set (privacy, cookies, terms, returns, accessibility).
 *
 * These came from Elementor, which keeps each element's styling in a
 * generated stylesheet keyed to that element's id. The port carried the ids
 * and not the stylesheet, so the pages arrived structurally correct and
 * completely unstyled — every heading pinned to the viewport edge.
 *
 * I tried porting the reference's computed styles element by element and it
 * does not hold up: width in the reference comes from ancestors that the
 * conversion flattened, so per-element widths either do nothing or shrink each
 * heading to its own text. These pages are DOCUMENTS, though — a centred
 * column with a type scale is what they actually are, and one stylesheet that
 * says so beats seven brittle snapshots.
 *
 * A page that needs a real designed layout (contact) still carries its own
 * meta.css, which is injected after this and wins.
 */
export const PORTED_DOC_CSS = `
/* A heading that exists for the document outline but not for the eye. Used
   where a ported layout has no h1 of its own — see bareOrArticle in site.ts. */
.th-sr-only{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;
  overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

#brx-content .brxe-container,#brx-content .brxe-block,#brx-content .brxe-section{
  width:100%;max-width:100%}
/* The column. Everything in these pages lives inside it. */
#brx-content > .brxe-container,#brx-content > .brxe-section,
#brx-content > .brxe-block{
  max-width:var(--th-site-max,1400px);margin-left:auto;margin-right:auto;
  padding-left:40px;padding-right:40px}
/* The ported header hard-codes its own 1170px column. Content wider than the
   header reads as misaligned rather than roomy, so the header is pulled onto
   the SAME variable — one number moves both. */
.c-header--desktop,.c-header--mobile,.c-header__inner,.c-shop-header__inner{
  max-width:var(--th-site-max,1400px)!important;margin-left:auto;margin-right:auto}
/* Nested containers must not re-pad — the column already has its gutters. */
#brx-content .brxe-container .brxe-container{padding-left:0;padding-right:0}
#brx-content h1,#brx-content h2,#brx-content h3,#brx-content h4{
  line-height:1.1;margin:0 0 .4em;letter-spacing:-.01em}
#brx-content h1{font-size:clamp(38px,5vw,64px)}
#brx-content h2{font-size:clamp(24px,3vw,34px);margin-top:1.6em}
#brx-content h3{font-size:clamp(18px,2vw,22px);margin-top:1.4em}
#brx-content p,#brx-content li{font-size:16px;line-height:1.75;margin:0 0 1em}
#brx-content ul,#brx-content ol{margin:0 0 1.2em 1.3em}
/* Underline PROSE links only. A blanket rule underlined every accordion
   title and swallowed the +/- toggles, which are links too. */
#brx-content .brxe-text a,#brx-content p a,#brx-content li a{
  text-decoration:underline;text-underline-offset:3px}
#brx-content .brxe-text{max-width:78ch}
/* The FAQ accordions: the theme ships the toggle, not the spacing. */
#brx-content .brxe-accordion,#brx-content [class*="accordion"]{width:100%}
#brx-content img{max-width:100%;height:auto}
@media(max-width:767px){
  #brx-content > .brxe-container,#brx-content > .brxe-section,
  #brx-content > .brxe-block{padding-left:20px;padding-right:20px}
}
`;

export interface NavItem {
  href: string;
  label: string;
  current?: boolean;
}

export interface SitePage {
  title: string; // <title> content, already includes site name where wanted
  headExtra?: string; // metaTags + jsonLd script, pre-escaped upstream
  siteName: string;
  nav: NavItem[];
  body: string;
  // WP Bridge chrome override: pre-rendered header/footer HTML + the ported
  // stylesheet URL. When set, they replace the Base Theme chrome and the main
  // column goes full-bleed (ported layouts manage their own widths).
  chromeHeader?: string;
  chromeFooter?: string;
  chromeCssUrl?: string;
  /** Settings > Site > Content width. Drives --th-site-max. */
  contentWidth?: 'narrow' | 'normal' | 'wide' | 'full';
  /** Front-end admin dock, rendered only for a signed-in admin. */
  dock?: { markup: string; styles: string; script: string };
  /** Settings > Performance, applied to the delivered HTML. */
  perf?: { lazyImages: boolean; minHtml: boolean; minCss: boolean };
  /** False removes the "Powered by Therum OS" credit — see Settings > Security. */
  showPlatformCredit?: boolean;
  /**
   * Settings > Counter. Only meaningful with ported chrome, which is what
   * carries the header's cart/search/wishlist hooks.
   */
  headerIcons?: HeaderCartConfig;
  /**
   * Page-scoped CSS, from `content.meta.css`.
   *
   * The ported pages came from Elementor, which puts each element's styling in
   * a generated stylesheet keyed to that element's id. The chrome stylesheet
   * covers the header and footer; everything inside a page needs its own, or
   * the markup arrives with the right ids and no rules to match them — which
   * is exactly why the contact page rendered as unstyled stacked text.
   *
   * Injected AFTER the chrome stylesheet so a page can override it, and it is
   * inert on any page that has none.
   */
  pageCss?: string;
}

// The one place the storefront column width is decided. It used to be a
// literal 1180px inside the stylesheet, which is why it kept reverting: every
// fix was applied somewhere else and this constant won.
const SITE_WIDTHS: Record<string, string> = {
  narrow: '1180px',
  normal: '1320px',
  wide: '1440px',
  full: '100%',
};

export function sitePage(p: SitePage): string {
  const siteMax = SITE_WIDTHS[p.contentWidth ?? 'wide'] ?? SITE_WIDTHS.wide;
  const nav = p.nav.map((n) => `<a href="${esc(n.href)}"${n.current ? ' class="current"' : ''}>${esc(n.label)}</a>`).join('');
  const hasChrome = Boolean(p.chromeHeader || p.chromeFooter);
  const header = p.chromeHeader
    ? `<div id="brx-header">${p.chromeHeader}</div>`
    : `<header class="site"><div class="wrap">
  <a class="brand" href="/"><span class="dot"></span>${esc(p.siteName)}</a>
  <nav class="main">${nav}</nav>
</div></header>`;
  const footer = p.chromeFooter
    ? `<div id="brx-footer">${p.chromeFooter}</div>`
    : `<footer class="site"><div class="wrap"><span>© ${new Date().getFullYear()} ${esc(p.siteName)}</span>${p.showPlatformCredit === false ? '' : '<span>Powered by Therum OS</span>'}</div></footer>`;
  const main = hasChrome ? `<main id="brx-content">${p.body}</main>` : `<main><div class="wrap">
${p.body}
</div></main>`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.title)}</title>
${p.headExtra ?? ''}
<style>:root{--th-site-max:${siteMax}}${CSS}${BANNER_STYLES}${hasChrome ? HEADER_CART_CSS + PORTED_DOC_CSS : ''}</style>
${p.dock ? `<style>${p.dock.styles}</style>` : ''}
${p.chromeCssUrl ? `<link rel="stylesheet" href="${esc(p.chromeCssUrl)}">` : ''}
${p.pageCss ? `<style>${p.pageCss}</style>` : ''}
</head>
<body class="home">
<div id="th-shell">
${header}
${main}
${footer}
</div>
${p.dock ? `${p.dock.markup}\n<script>${p.dock.script}</script>` : ''}
<script>${BANNER_RUNTIME}</script>
${hasChrome ? `<script>${headerCartRuntime(p.headerIcons ?? HEADER_CART_DEFAULTS)}</script>` : ''}
</body>
</html>`;
  return applyPerf(html, p.perf);
}

// Settings > Performance, finally doing something. `lazyImages`, `minHtml` and
// `minCss` all saved and were read by nothing; the rest of that page's toggles
// (emoji, embeds, heartbeat, revisions, trash, autosave) configure WordPress-era
// features this stack does not have, and are labelled as such on the page
// rather than faked here.
function applyPerf(html: string, perf?: { lazyImages: boolean; minHtml: boolean; minCss: boolean }): string {
  if (!perf) return html;
  let out = html;

  if (perf.lazyImages) {
    // Only images that do not already declare a loading strategy — a ported
    // Bricks layout may legitimately want an eager hero.
    out = out.replace(/<img(?![^>]*\bloading=)([^>]*)>/gi, '<img loading="lazy" decoding="async"$1>');
  }

  if (perf.minCss) {
    out = out.replace(/<style>([\s\S]*?)<\/style>/gi, (_m, css: string) =>
      `<style>${css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*([{}:;,>])\s*/g, '$1')
        .replace(/;}/g, '}')
        .trim()}</style>`);
  }

  if (perf.minHtml) {
    // Whitespace between tags only. Anything inside <pre>, <textarea>,
    // <script> or <style> is left exactly as-is — collapsing those changes
    // what the page means, not just its size.
    const keep: string[] = [];
    out = out.replace(/<(pre|textarea|script|style)\b[\s\S]*?<\/\1>/gi, (m) => {
      keep.push(m);
      return `\u0000${keep.length - 1}\u0000`;
    });
    out = out.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();
    out = out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => keep[Number(i)] ?? '');
  }

  return out;
}
