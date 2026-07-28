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
  /** Front-end admin dock, rendered only for a signed-in admin. */
  dock?: { markup: string; styles: string; script: string };
  /** Settings > Performance, applied to the delivered HTML. */
  perf?: { lazyImages: boolean; minHtml: boolean; minCss: boolean };
}

export function sitePage(p: SitePage): string {
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
    : `<footer class="site"><div class="wrap"><span>© ${new Date().getFullYear()} ${esc(p.siteName)}</span><span>Powered by Therum OS</span></div></footer>`;
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
<style>${CSS}</style>
${p.dock ? `<style>${p.dock.styles}</style>` : ''}
${p.chromeCssUrl ? `<link rel="stylesheet" href="${esc(p.chromeCssUrl)}">` : ''}
</head>
<body class="home">
${header}
${main}
${footer}
${p.dock ? `${p.dock.markup}\n<script>${p.dock.script}</script>` : ''}
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
