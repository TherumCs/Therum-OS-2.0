import type { Maintenance } from '../services/settings.service.js';
import { esc } from './html.js';

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
  const poster = m.videoPoster || m.backgroundImage;

  // The still is the floor, not the fallback: it is what shows while the video
  // buffers, what iOS Low Power Mode leaves you with, and what anyone who asked
  // their OS to reduce motion keeps. The video layers on top when it can.
  const bg = poster
    ? `background-image:linear-gradient(rgba(0,0,0,.55),rgba(0,0,0,.62)),url('${esc(poster)}');background-size:cover;background-position:center`
    : 'background:radial-gradient(120% 120% at 50% 0%,#1b2030 0%,#0b0d12 60%,#07080b 100%)';

  const video = comingSoon && m.backgroundVideo
    ? `<video class="bgv" autoplay muted loop playsinline preload="auto"${poster ? ` poster="${esc(poster)}"` : ''}>
         <source src="${esc(m.backgroundVideo)}">
       </video>
       <div class="scrim"></div>`
    : '';

  const countdown = comingSoon && m.countdownTo
    ? `<div class="cd" data-countdown-to="${esc(m.countdownTo)}" hidden>
         ${m.countdownLabel ? `<div class="cd__label">${esc(m.countdownLabel)}</div>` : ''}
         <div class="cd__row">
           <div class="cd__unit"><span data-cd="d">--</span><em>days</em></div>
           <div class="cd__unit"><span data-cd="h">--</span><em>hrs</em></div>
           <div class="cd__unit"><span data-cd="m">--</span><em>min</em></div>
           <div class="cd__unit"><span data-cd="s">--</span><em>sec</em></div>
         </div>
       </div>`
    : '';

  const signup = comingSoon && m.emailCapture
    ? `<form class="notify" data-notify novalidate>
         <input type="email" name="email" required autocomplete="email"
                placeholder="${esc(m.emailPlaceholder || 'Your email')}" aria-label="Email address">
         <button type="submit">${esc(m.emailButtonLabel || 'Notify me')}</button>
       </form>
       <p class="notify__msg" data-notify-msg role="status" aria-live="polite"></p>`
    : '';

  const instagram = comingSoon && m.instagram
    ? `<a class="ig" href="https://instagram.com/${esc(m.instagram)}" target="_blank" rel="noopener">
         <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8">
           <rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="3.6"/><circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none"/>
         </svg>
         <span>@${esc(m.instagram)}</span>
       </a>`
    : '';

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
    display:flex;align-items:center;justify-content:center;text-align:center;padding:32px;
    position:relative;overflow:hidden}

  /* The video sits BEHIND everything and is decorative. object-fit:cover so it
     fills any viewport without letterboxing, and it never intercepts a click. */
  .bgv{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;pointer-events:none}
  .scrim{position:fixed;inset:0;z-index:1;pointer-events:none;
    background:linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.62))}
  .box{position:relative;z-index:2;max-width:600px;width:100%}

  .logo{max-width:180px;height:auto;margin:0 0 28px;opacity:.95}
  h1{font-size:clamp(30px,6vw,52px);line-height:1.1;margin:0 0 14px;letter-spacing:-.03em;
     text-wrap:balance;text-shadow:0 2px 30px rgba(0,0,0,.4)}
  p{margin:0 auto;color:rgba(255,255,255,.82);max-width:44ch}

  .cd{margin:30px 0 4px}
  .cd__label{font-size:11px;letter-spacing:.18em;text-transform:uppercase;
    color:rgba(255,255,255,.6);margin-bottom:12px}
  .cd__row{display:flex;gap:10px;justify-content:center}
  .cd__unit{min-width:74px;padding:12px 8px;border-radius:12px;
    background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);
    backdrop-filter:blur(6px)}
  /* Tabular figures so the digits do not jiggle as the seconds tick. */
  .cd__unit span{display:block;font-size:clamp(22px,4vw,30px);font-weight:700;
    font-variant-numeric:tabular-nums;letter-spacing:-.02em;line-height:1.1}
  .cd__unit em{display:block;font-style:normal;font-size:10px;letter-spacing:.14em;
    text-transform:uppercase;color:rgba(255,255,255,.55);margin-top:4px}

  .notify{display:flex;gap:8px;max-width:420px;margin:28px auto 0}
  .notify input{flex:1;min-width:0;padding:13px 16px;border-radius:999px;
    border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.1);
    color:#fff;font:inherit;font-size:15px;backdrop-filter:blur(6px)}
  .notify input::placeholder{color:rgba(255,255,255,.55)}
  .notify input:focus{outline:2px solid rgba(255,255,255,.75);outline-offset:1px;border-color:transparent}
  .notify button{padding:13px 24px;border-radius:999px;border:0;background:#fff;color:#111;
    font:inherit;font-weight:700;font-size:14px;cursor:pointer;white-space:nowrap;
    transition:transform .15s ease,opacity .15s ease}
  .notify button:hover{transform:translateY(-1px)}
  .notify button:disabled{opacity:.6;cursor:default;transform:none}
  .notify__msg{margin:12px 0 0;font-size:13px;min-height:1.2em;color:rgba(255,255,255,.85)}
  .notify__msg[data-bad]{color:#ffb4b4}

  .cta{display:inline-block;margin-top:28px;padding:13px 30px;border:1px solid rgba(255,255,255,.6);
    border-radius:999px;color:#fff;text-decoration:none;font-weight:600;font-size:14px;
    letter-spacing:.04em;text-transform:uppercase;transition:background .2s ease,color .2s ease}
  .cta:hover{background:#fff;color:#111}

  .ig{display:inline-flex;align-items:center;gap:8px;margin-top:26px;padding:9px 18px;
    border-radius:999px;border:1px solid rgba(255,255,255,.25);color:rgba(255,255,255,.9);
    text-decoration:none;font-size:13px;font-weight:600;transition:background .2s ease,border-color .2s ease}
  .ig:hover{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.45)}

  .foot{margin-top:40px;font-size:12px;color:rgba(255,255,255,.45)}

  /* A decorative loop is exactly what this setting is for. The poster stays. */
  @media (prefers-reduced-motion: reduce){ .bgv{display:none} }
  @media (max-width:520px){
    .cd__unit{min-width:0;flex:1}
    .notify{flex-direction:column;border-radius:0}
    .notify button{width:100%}
  }
</style>
</head><body>
  ${video}
  <div class="box">
    ${logoUrl ? `<img class="logo" src="${esc(logoUrl)}" alt="${esc(siteName)}">` : ''}
    <h1>${esc(heading)}</h1>
    ${m.message ? `<p>${esc(m.message)}</p>` : ''}
    ${countdown}
    ${signup}
    ${m.buttonLabel && m.buttonHref ? `<a class="cta" href="${esc(m.buttonHref)}">${esc(m.buttonLabel)}</a>` : ''}
    ${instagram}
    <div class="foot">${esc(siteName)}</div>
  </div>
<script>
(function(){
  // COUNTDOWN. Rendered hidden and revealed by script: a "--:--:--" that never
  // ticks because JS failed is worse than no countdown at all.
  var cd = document.querySelector('[data-countdown-to]');
  if (cd) {
    var target = Date.parse(cd.getAttribute('data-countdown-to'));
    if (!isNaN(target)) {
      var out = {
        d: cd.querySelector('[data-cd="d"]'), h: cd.querySelector('[data-cd="h"]'),
        m: cd.querySelector('[data-cd="m"]'), s: cd.querySelector('[data-cd="s"]')
      };
      var pad = function(n){ return (n < 10 ? '0' : '') + n; };
      var tick = function(){
        var left = target - Date.now();
        if (left <= 0) {
          // Past the date the countdown is a lie. It hides rather than sitting
          // at zero, and the page keeps working.
          cd.hidden = true;
          return;
        }
        var s = Math.floor(left / 1000);
        out.d.textContent = String(Math.floor(s / 86400));
        out.h.textContent = pad(Math.floor(s % 86400 / 3600));
        out.m.textContent = pad(Math.floor(s % 3600 / 60));
        out.s.textContent = pad(s % 60);
        cd.hidden = false;
      };
      tick();
      setInterval(tick, 1000);
    }
  }

  // EMAIL CAPTURE. Posts JSON; the endpoint is idempotent, so a second submit
  // of the same address is a success rather than a duplicate-key error the
  // visitor has to interpret.
  var form = document.querySelector('[data-notify]');
  if (form) {
    var msg = document.querySelector('[data-notify-msg]');
    var say = function(text, bad){
      msg.textContent = text;
      if (bad) msg.setAttribute('data-bad',''); else msg.removeAttribute('data-bad');
    };
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var input = form.querySelector('input[name=email]');
      var btn = form.querySelector('button');
      var email = (input.value || '').trim();
      if (!email || email.indexOf('@') === -1) return say('That email does not look right.', true);
      btn.disabled = true;
      say('');
      fetch('/api/shop/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email })
      }).then(function(r){ return r.json().then(function(b){ return { ok: r.ok, body: b }; }); })
        .then(function(res){
          if (!res.ok) throw new Error((res.body && res.body.error && res.body.error.message) || 'Could not sign you up.');
          form.hidden = true;
          say(${JSON.stringify(m.emailThanks || "You're on the list.")});
        })
        .catch(function(err){ say(err.message, true); btn.disabled = false; });
    });
  }
})();
</script>
</body></html>`;
}
