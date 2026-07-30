import type { Maintenance } from '../services/settings.service.js';
import { esc } from './storefrontHtml.js';

// The maintenance / coming-soon screen, built into Therum OS.
//
// Deliberately NOT ordinary page content. A maintenance page stored as a
// published page is one an editor can unpublish, one that needs the very
// database and template stack that may be the thing you are working on, and
// one that only covers routes the CMS happens to own. This is a self-contained
// string with no data dependencies beyond the settings row it is handed.
//
// It carries its own CSS inline for the same reason: if the stylesheet lives
// in the media library and the media library is what broke, the "we'll be back
// shortly" page is what the visitor sees unstyled.

export function maintenancePage(m: Maintenance, siteName: string, logoUrl?: string | null): string {
  const comingSoon = m.mode === 'coming-soon';
  const heading = m.heading || (comingSoon ? 'Coming soon' : 'We will be back shortly');
  const bg = m.backgroundImage
    ? `background-image:linear-gradient(rgba(0,0,0,.55),rgba(0,0,0,.55)),url('${esc(m.backgroundImage)}');background-size:cover;background-position:center`
    : 'background:#0f1115';

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(heading)} — ${esc(siteName)}</title>
${
    // A maintenance window is temporary; a coming-soon page is a real page you
    // want indexed. Telling crawlers to drop a launch teaser would be a
    // self-inflicted wound.
    comingSoon ? '' : '<meta name="robots" content="noindex">'
  }
<style>
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;${bg};color:#fff;
    font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;
    display:flex;align-items:center;justify-content:center;text-align:center;padding:32px}
  .box{max-width:560px}
  .logo{max-width:180px;height:auto;margin:0 0 28px;opacity:.95}
  h1{font-size:clamp(28px,5vw,44px);line-height:1.15;margin:0 0 14px;letter-spacing:-.02em}
  p{margin:0 auto;color:rgba(255,255,255,.78);max-width:44ch}
  .cta{display:inline-block;margin-top:28px;padding:13px 30px;border:1px solid rgba(255,255,255,.6);
    border-radius:999px;color:#fff;text-decoration:none;font-weight:600;font-size:14px;
    letter-spacing:.04em;text-transform:uppercase;transition:background .2s ease,color .2s ease}
  .cta:hover{background:#fff;color:#111}
  .foot{margin-top:40px;font-size:12px;color:rgba(255,255,255,.45)}
</style>
</head><body>
  <div class="box">
    ${logoUrl ? `<img class="logo" src="${esc(logoUrl)}" alt="${esc(siteName)}">` : ''}
    <h1>${esc(heading)}</h1>
    ${m.message ? `<p>${esc(m.message)}</p>` : ''}
    ${m.buttonLabel && m.buttonHref ? `<a class="cta" href="${esc(m.buttonHref)}">${esc(m.buttonLabel)}</a>` : ''}
    <div class="foot">${esc(siteName)}</div>
  </div>
</body></html>`;
}
