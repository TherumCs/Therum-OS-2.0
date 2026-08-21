import { BANNER_RUNTIME, BANNER_STYLES } from './bannerRuntime.js';
import { CONTACT_CSS, CONTACT_RUNTIME } from './contactForm.js';
import { COUNTDOWN_RUNTIME } from './countdownRuntime.js';
import { SUBSCRIBE_SCRIPT } from './shortcodes.js';
import { MOBILE_MENU_CSS, MOBILE_MENU_RUNTIME } from './mobileMenu.js';
import { HEADER_CART_CSS, headerCartRuntime, HEADER_CART_DEFAULTS, type HeaderCartConfig } from './headerCart.js';
// Base Theme — the default public frontend shell. Deliberately minimal
// (Bam: "default theme so stuff is just popping up"; the full theme system
// is on the future-buildout list). Same real-1.9.44 token values as the
// storefront so the whole public surface reads as one site. Server-rendered,
// zero client JS except the cart badge when commerce is on.

import { esc } from './html.js';

// Mobile overrides for the ported home page. Injected as the LAST stylesheet in
// the head (after the chrome CSS link), so they win on load order without a
// specificity fight. Home-scoped selectors, so they no-op on every other page.
// NOTE: the .th-el-<id> selectors are the ported canvas element ids of the home
// page's three hero blocks (Snapback / Soul Tee / Explore). Each hero has a
// logo COLUMN (d4a9169, 0426091, cd08c4c — desktop left-offset to kill), a CTA
// button (63a81bf, 4d297e5, 084d34c) and a subtext link (2ff5950, 0e291aa,
// 83ace67). th-el-8700216 is the "money shots" two-panel block. These ids are
// stable unless the home page is re-edited in the studio — refresh them if so.
// .tsc-season-2col is our own stable class.
// Mobile home spec (Bam): every hero / promo section is a uniform 9:16 portrait
// panel, full-bleed and un-stacked. The three heroes (a7707ab Snapback, 28391e5
// Womens, 7810284 Soul Tee) carry their photo as the section's OWN cover
// background, so pinning the aspect ratio reflows the photo with no white band.
// min-height:0 clears the ported fixed heights (650/812px). Media-carrier
// sections (banners, city-series post-card, season bg-panels, the money-shot
// video block) then need their image/video forced to fill the new 9:16 box.
const HOME_MOBILE_CSS = `@media(max-width:767px){`
  + `.th-el-a7707ab,.th-el-28391e5,.th-el-7810284,.th-el-8700216,.tsc-season-2col{aspect-ratio:9/16!important;height:auto!important;min-height:0!important}`
  // Banner sections — the category stack (5b95f66) and the single "cost us alot"
  // band (85180a7) — nest the image many wrappers deep, so height:100% never
  // cascades from the section. Pin the banner ITEM itself to 9:16 instead: its
  // ancestors are height:auto and wrap to it, so the whole section takes 9:16.
  + `.th-el-5b95f66 .c-ip-banners__item,.th-el-85180a7 .c-ip-banners__item{aspect-ratio:9/16!important;height:auto!important;min-height:0!important}`
  + `.th-el-5b95f66 .c-ip-banners__image,.th-el-85180a7 .c-ip-banners__image{height:100%!important;object-fit:cover!important}`
  // City Series (th-el-5cc1cfe) is a NEWS card — image + headline + Read more.
  // Bam: leave it natural, do NOT force it to 9:16 like the image sections.
  // Season two-panel: the bg-image panels fill the shared 9:16 box.
  + `.tsc-season-2col .tsc-season-panel{aspect-ratio:auto;height:100%!important}`
  // Money-shots: two stacked halves inside the one 9:16 panel; video covers.
  + `.th-el-8700216{gap:0}`
  + `.th-el-8700216 > .th-el{height:50%!important;flex:0 0 50%!important;flex-basis:50%!important}`
  + `.th-el-8700216 .tsc-vid,.th-el-8700216 video{height:100%!important;object-fit:cover!important}`
  // All three heroes: kill the desktop 48px left-offset so the logo centres,
  // and take the CTA + the subtext link down a notch.
  + `.th-el-d4a9169,.th-el-0426091,.th-el-cd08c4c{padding-left:0!important;justify-content:center!important}`
  + `.th-el-63a81bf .c-ip-button,.th-el-4d297e5 .c-ip-button,.th-el-084d34c .c-ip-button{padding:12px 30px!important;font-size:11px!important}`
  + `.th-el-2ff5950 .c-ip-button,.th-el-0e291aa .c-ip-button,.th-el-83ace67 .c-ip-button{font-size:12px!important}`
  + `}`;

const CSS = `
:root{
  /* Same ink as the storefront and the ported theme (--button-color). Content
     pages and shop pages sit next to each other in one nav; two different
     action colours reads as two different sites. */
  --ac:#e83b3b;--ac-btn:#070707;--ac-btn-h:#252525;
  --sf:#ffffff;--sf2:#f5f5f5;--bd:rgba(0,0,0,0.08);--bd2:rgba(0,0,0,0.16);
  --bg:#fafafa;--tx:#0a0a0a;--tx2:#666666;--tx3:#999999;
  --f:-apple-system,BlinkMacSystemFont,'Inter','Helvetica Neue',Arial,sans-serif;
  --e:0.15s ease;--radius-md:10px;--radius-lg:14px;--radius-pill:999px;
}
*{box-sizing:border-box;margin:0;padding:0}
:where(body){font-family:var(--f);background:var(--bg);color:var(--tx);line-height:1.65;-webkit-font-smoothing:antialiased}
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
   under the nav as an unexplained white gap above the hero.
   main.l-inner is the PORTED theme's own main, nested inside ours, so the
   id-only override missed it: measured 48px on our page against 0px on the
   reference, which is the white strip under the menu bar. */
main#brx-content,main.l-inner{padding-top:0;padding-bottom:0}
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
 * Structural repairs for the ported pages. Deliberately NOT a layout.
 *
 * This used to impose a centred 1400px column, 40px gutters and a type scale,
 * because the port had carried Elementor's element ids without the stylesheet
 * that styles them and the pages arrived completely unstyled. That was a
 * stand-in for a stylesheet we did not have.
 *
 * We have it now: the reference site's full CSS is extracted from every page
 * at every breakpoint and served as one universal stylesheet. The stand-in
 * then stopped being a fallback and became a competitor — it was overriding
 * the real theme layout, which is what left the policy pages 13-24% off the
 * reference height while looking superficially fine.
 *
 * So what remains here is only what the imported CSS cannot do for itself:
 * an accessible heading, an img guard, the --display default that stops
 * Elementor containers computing to `inline`, and a narrow-viewport cap for
 * elements whose width was snapshotted at 375px. Layout belongs to the
 * imported stylesheet. Anything added back here should be treated as evidence
 * that the extraction missed something, and fixed there instead.
 *
 * A page that needs a genuinely custom layout still carries its own meta.css,
 * injected after this and after the universal sheet, so it wins.
 */
export const PORTED_DOC_CSS = `
/* A heading that exists for the document outline but not for the eye. Used
   where a ported layout has no h1 of its own — see bareOrArticle in site.ts. */
.th-sr-only{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;
  overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

:where(#brx-content .brxe-container,#brx-content .brxe-block,#brx-content .brxe-section){
  width:100%;max-width:100%}
:where(#brx-content) img{max-width:100%;height:auto}
/* Nodes the conversion invented — no element of this id exists on the
   reference. display:contents keeps them and their children in the DOM while
   removing the box they were never supposed to contribute. See th-no-ref in
   src/lib/render.ts. */
/* !important is deliberate and is the narrow case that warrants it: .e-con
   sets display from a custom property at class specificity, and the imported
   sheet is linked after this one, so it wins every tie. This has to beat it —
   the node does not exist on the reference at all. */
.th-no-ref{display:contents!important}
/* Footer newsletter signup. Our own component, not a ported one: the import
   dropped the Subscribe widget's contents entirely and left an empty node, and
   because every footer column stretches to the tallest, that one collapsed
   element made all four render 225px against the reference's 275px. It lives
   here rather than in a page's meta.css because the footer is chrome — it is
   on every page, and page CSS is not injected for it. */
.tsc-sub{width:100%}
/* Label kept for screen readers but taken out of the flow: visible it added
   19px, and this column sets the height of all four (the reference's slot is
   50px). The input carries a placeholder for sighted users. */
.tsc-sub__label{position:absolute;width:1px;height:1px;padding:0;margin:-1px;
  overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.tsc-sub__row{display:flex;gap:8px;align-items:stretch}
.tsc-sub__input{flex:1 1 auto;min-width:0;padding:10px 12px;font:inherit;font-size:14px;
  color:inherit;background:transparent;border:1px solid currentColor;border-radius:0}
.tsc-sub__input::placeholder{color:currentColor;opacity:.45}
.tsc-sub__input:focus{outline:0;box-shadow:inset 0 0 0 1px currentColor}
.tsc-sub__go{flex:0 0 auto;padding:10px 16px;font:inherit;font-size:12px;font-weight:600;
  letter-spacing:.04em;text-transform:uppercase;cursor:pointer;
  color:#fff;background:#070707;border:1px solid #070707}
.tsc-sub__go:disabled{opacity:.5;cursor:default}
.tsc-sub__note:empty{display:none}
.tsc-sub__note{margin-top:8px;font-size:12px;line-height:1.4;opacity:.7}
@media(max-width:767px){
  .tsc-sub__row{flex-wrap:wrap}
  .tsc-sub__go{width:100%}
}
/* Some ported elements carry a width snapshotted from a 375px-wide render —
   the contact page's h1 is a literal 354.984px sitting inside a correct 320px
   container. On anything narrower than that snapshot they push the document
   past the viewport. Capping to the container fixes it without unpicking the
   snapshots: max-width beats width whatever the specificity, and :where()
   keeps this from outranking a width that was chosen on purpose. Scoped below
   375 so wider layouts, where the snapshots are harmless, are untouched. */
@media(max-width:374px){
  :where(#brx-content) :where([class*="el-"]){max-width:100%}
}
/* Footer columns on tablet. The ported layout lays the five columns out in a
   flex-wrap ROW, and because they are different heights — the newsletter block
   is tall, "LEARN" is two links — the wrap staggers them: a heading drifts away
   from its own list and the next column collides into the gap. A grid with the
   rows aligned to the top removes the masonry. #brx-footer gives this id-level
   specificity so it beats the ported sheet, which is linked AFTER this block.
   Above 1023 the five sit in their intended row; below 560 they stack. */
@media(max-width:1023px){
  #brx-footer .th-el-97b044b{display:grid;grid-template-columns:1fr 1fr;align-items:start;gap:36px 24px}
  /* The newsletter block (first child, no link list) is much taller than a
     two-link column like LEARN. Left in the same grid row it forces that row
     tall and drops a big gap between LEARN and POLICIES. Spanning it full width
     lets the four real link columns align as a clean 2x2 beneath it. */
  #brx-footer .th-el-97b044b > :first-child{grid-column:1/-1}
}
@media(max-width:560px){
  #brx-footer .th-el-97b044b{grid-template-columns:1fr;gap:30px}
}
/* Mobile footer (Bam): centre the sign-up heading, subscribe box, help text,
   social row and copyright. A full-width rule then separates that centred block
   from the four link menus (LEARN / STORE / POLICIES / COMMUNICATIONS),
   which stay LEFT-aligned — centred lists read badly. #brx-footer id-specificity
   beats the ported sheet, which is linked after this block. */
@media(max-width:767px){
  #brx-footer .th-el-6b664c6,
  #brx-footer .th-el-510e33c,
  #brx-footer .th-el-8ec8d7d{text-align:center}
  #brx-footer .th-el-510e33c .tsc-sub__row{justify-content:center}
  /* Bottom bar is a column-reverse flex (copyright then social in the DOM, so
     social renders above copyright). Centre both on the cross axis. */
  #brx-footer .th-el-5c9433d{align-items:center;text-align:center}
  /* The rule: sits above LEARN, the first menu, spanning the footer content. */
  #brx-footer .th-el-51652e5{border-top:1px solid rgba(255,255,255,.16);margin-top:12px;padding-top:34px}
}
/* THE DOUBLE CART. The ported ideapark slide-out mobile menu is dead on this
   stack — its open/close JS was ideapark's, and it is replaced by the .th-mmenu
   overlay. Left in the flow, the panel renders its own nav AND a SECOND cart
   button (.c-header__menu-bottom) right beside the real header bag, which is
   the "double cart" that also shoves things around on resize. Hide the panel
   and its scrim; keep .c-header__menu-button (the hamburger that opens the
   overlay) untouched — it is a different class. display:none keeps the ported
   nav links in the DOM, so the overlay can still read them. */
#brx-header .c-header__menu-wrap,
#brx-header .c-header__menu-shadow,
#brx-header .c-header__menu-content,
#brx-header .c-header__menu-bottom{display:none!important}
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
export const SITE_WIDTHS: Record<string, string> = {
  narrow: '1180px',
  normal: '1320px',
  wide: '1440px',
  full: '100%',
};

// The ported theme hangs its left-to-right rules off a body class, and the
// running-line marquee is one of them:
//
//     .h-ltr .c-ip-running-line__content { animation: ... running-line-scroll }
//
// Without it the marquee has no animation-name at all, so it sits still and
// its text is clipped by the strip's overflow:hidden — which is exactly how it
// read on mobile. The reference carries h-ltr on <body>; this is that class.
const BODY_CLASS = 'home h-ltr';

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
  const scoped = p.body;
  const main = hasChrome ? `<main id="brx-content">${scoped}</main>` : `<main><div class="wrap">
${p.body}
</div></main>`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="facebook-domain-verification" content="9t3nhx1yw9xijatt76fw2lzktpi878">
<title>${esc(p.title)}</title>
${p.headExtra ?? ''}
<style>:root{--th-site-max:${siteMax}}${CSS}${BANNER_STYLES}${CONTACT_CSS}${hasChrome ? HEADER_CART_CSS + PORTED_DOC_CSS + MOBILE_MENU_CSS : ''}</style>
${p.dock ? `<style>${p.dock.styles}</style>` : ''}
${p.chromeCssUrl ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&display=swap"><link rel="stylesheet" href="${esc(p.chromeCssUrl)}">` : ''}
${p.pageCss ? `<style>${p.pageCss}</style>` : ''}
<style>${HOME_MOBILE_CSS}</style>
</head>
<body class="${BODY_CLASS}">
<div id="th-shell">
${header}
${main}
${footer}
</div>
${p.dock ? `${p.dock.markup}\n<script>${p.dock.script}</script>` : ''}
<script>${BANNER_RUNTIME}${SUBSCRIBE_SCRIPT}${CONTACT_RUNTIME}${COUNTDOWN_RUNTIME}</script>
${hasChrome ? `<script>${headerCartRuntime(p.headerIcons ?? HEADER_CART_DEFAULTS)}</script><script>${MOBILE_MENU_RUNTIME}</script>` : ''}
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
