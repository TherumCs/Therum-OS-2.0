// Subscribe popup — the storefront side of Marketing › Forms.
//
// Self-contained inline script + styles, injected into both page shells. It
// asks the API which popup is live (one small GET, after load, cached a
// minute), decides whether THIS browser should see it, and only then builds
// the markup. Nothing renders for a visitor the rules exclude, so the cost of
// having the feature on is one request and no layout shift.
//
// Who never sees it (Bam's brief: "not super intrusive"):
//   - anyone who already subscribed here (th_sub cookie, set by the API on any
//     signup — footer, popup, checkout), ever
//   - anyone who closed it, for `dismissDays` (th_pop cookie)
//   - a second time in the same session (sessionStorage), whatever else says
//   - a signed-in shopper (th_customer cookie)
//   - cart / checkout / order-received / account / unsubscribe pages
// The key is the browser, not the IP: shared and rotating IPs would either
// nag the wrong person or never show a genuinely new visitor anything.

export const POPUP_STYLES = `
.th-pop{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(10,10,10,.55);opacity:0;transition:opacity .25s ease}
.th-pop.on{opacity:1}
.th-pop__card{position:relative;width:100%;max-width:420px;background:#fff;border-radius:14px;padding:38px 32px 30px;text-align:center;color:#0a0a0a;font-family:inherit;transform:translateY(10px);transition:transform .25s ease;box-shadow:0 30px 80px rgba(0,0,0,.35)}
.th-pop.on .th-pop__card{transform:none}
.th-pop__x{position:absolute;top:10px;right:10px;width:36px;height:36px;border:0;background:transparent;color:#8a8a8a;font-size:22px;line-height:1;cursor:pointer;border-radius:50%}
.th-pop__x:hover{background:#f2f2f2;color:#0a0a0a}
.th-pop__bar{height:3px;width:44px;background:var(--th-pop-accent,#e83b3b);margin:0 auto 20px}
.th-pop__logo{display:block;width:150px;max-width:56%;height:auto;margin:0 auto 4px}
.th-pop__eyebrow{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--th-pop-accent,#e83b3b);font-weight:700}
.th-pop__h{margin:10px 0 0;font-size:26px;line-height:1.15;letter-spacing:-.02em;font-weight:800}
.th-pop__p{margin:12px 0 0;font-size:15px;line-height:1.6;color:#4a4a4a}
.th-pop__form{display:flex;flex-direction:column;gap:10px;margin-top:22px}
.th-pop__in{height:46px;border:1px solid #e7e7e7;border-radius:0;padding:0 14px;font-size:15px;color:#0a0a0a;background:#fff;width:100%;box-sizing:border-box;font-family:inherit}
.th-pop__in:focus{outline:2px solid #0a0a0a;outline-offset:-1px}
.th-pop__go{height:48px;border:0;border-radius:0;background:#070707;color:#fff;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;cursor:pointer;font-family:inherit}
.th-pop__go[disabled]{opacity:.6;cursor:default}
.th-pop__note{margin:14px 0 0;font-size:12px;color:#8a8a8a;min-height:1.2em}
.th-pop__note.err{color:#e83b3b}
.th-pop__done{padding:8px 0 0}
.th-pop__consent{display:flex;gap:8px;align-items:flex-start;text-align:left;font-size:11px;line-height:1.5;color:#8a8a8a;margin-top:2px}.th-pop__consent input{margin-top:3px}
@media (max-width:480px){.th-pop{align-items:flex-end;padding:0}.th-pop__card{border-radius:14px 14px 0 0;max-width:none;padding:34px 22px 28px}.th-pop__h{font-size:23px}}
`;

export const POPUP_RUNTIME = `
(function(){
  try{
    if (window.__thPop) return; window.__thPop = 1;
    // Crawlers execute this script too (Meta's externalagent fired 10k "seen"
    // beacons in a day). Nothing here is for them.
    if (/bot|crawl|spider|slurp|externalagent|facebookexternalhit|preview|headless|lighthouse/i.test(navigator.userAgent || '')) return;
    var path = location.pathname || '/';
    var force = window.__thPopForce === true || /[?&]th_pop=1(&|$)/.test(location.search);
    if (!force) {
      if (/^\\/(cart|checkout|order-received|account|api\\/shop\\/unsubscribe|wishlist)(\\/|$)/.test(path)) return;
      var ck = document.cookie || '';
      if (ck.indexOf('th_sub=') >= 0) return;
      if (ck.indexOf('th_pop=') >= 0) return;
      if (ck.indexOf('th_customer=') >= 0) return;
      try { if (sessionStorage.getItem('th_pop_s')) return; } catch (e) {}
    }
    function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
    function setCookie(k, v, days){ document.cookie = k + '=' + v + '; path=/; max-age=' + (days * 86400) + '; samesite=lax'; }
    function show(cfg){
      var s = cfg.settings || {};
      if (!force && s.pages === 'home' && path !== '/' && path !== '/shop' && path !== '/shop/') return;
      try { sessionStorage.setItem('th_pop_s', '1'); } catch (e) {}
      var wrap = document.createElement('div');
      wrap.className = 'th-pop';
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.setAttribute('aria-label', esc(s.headline || 'Subscribe'));
      if (s.accent) wrap.style.setProperty('--th-pop-accent', s.accent);
      wrap.innerHTML =
        '<div class="th-pop__card">' +
          '<button type="button" class="th-pop__x" aria-label="Close">&times;</button>' +
          '<div class="th-pop__bar"></div>' +
          (s.logo ? '<img class="th-pop__logo" src="' + esc(s.logo) + '" alt="' + esc(s.eyebrow || '') + '">' : (s.eyebrow ? '<div class="th-pop__eyebrow">' + esc(s.eyebrow) + '</div>' : '')) +
          '<h2 class="th-pop__h">' + esc(s.headline || '10% off your first order.') + '</h2>' +
          (s.body ? '<p class="th-pop__p">' + esc(s.body) + '</p>' : '') +
          '<form class="th-pop__form" novalidate>' +
            (s.askName ? '<input class="th-pop__in" type="text" name="first" placeholder="First name" autocomplete="given-name">' : '') +
            '<input class="th-pop__in" type="email" name="email" placeholder="' + esc(s.placeholder || 'name@email.com') + '" autocomplete="email" required>' +
            (s.askPhone ? '<input class="th-pop__in" type="tel" name="phone" placeholder="Mobile number (optional)" autocomplete="tel"><label class="th-pop__consent"><input type="checkbox" name="sms"> <span>' + esc(s.smsConsentText || 'Text me too. Msg & data rates may apply. Reply STOP to opt out.') + '</span></label>' : '') +
            '<button class="th-pop__go" type="submit">' + esc(s.buttonLabel || 'Get my code') + '</button>' +
          '</form>' +
          '<p class="th-pop__note" role="status" aria-live="polite">' + esc(s.footnote || '') + '</p>' +
        '</div>';
      document.body.appendChild(wrap);
      requestAnimationFrame(function(){ wrap.classList.add('on'); });
      // "Seen" means rendered — not "config arrived" (a visitor who leaves inside
      // the delay never saw it).
      try { navigator.sendBeacon && navigator.sendBeacon('/api/shop/forms/' + cfg.id + '/view'); } catch (e) {}
      var days = Number(s.dismissDays) > 0 ? Number(s.dismissDays) : 30;
      function close(){ setCookie('th_pop', '1', days); wrap.classList.remove('on'); setTimeout(function(){ wrap.remove(); }, 250); }
      wrap.querySelector('.th-pop__x').addEventListener('click', close);
      wrap.addEventListener('click', function(e){ if (e.target === wrap) close(); });
      document.addEventListener('keydown', function onKey(e){ if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } });
      var form = wrap.querySelector('form'), note = wrap.querySelector('.th-pop__note'), go = wrap.querySelector('.th-pop__go');
      var email = form.querySelector('[name=email]'), first = form.querySelector('[name=first]'), phone = form.querySelector('[name=phone]'), sms = form.querySelector('[name=sms]');
      setTimeout(function(){ try { (first || email).focus(); } catch (e) {} }, 300);
      // Enter in either field submits. Implicit submission is not something to
      // rely on inside a ported theme whose own scripts listen for keys.
      [first, email].forEach(function(el){ if (el) el.addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); if (form.requestSubmit) form.requestSubmit(go); else go.click(); } }); });
      form.addEventListener('submit', function(e){
        e.preventDefault();
        var v = (email.value || '').trim();
        if (!v || v.indexOf('@') < 1) { note.textContent = 'Enter a valid email address.'; note.className = 'th-pop__note err'; return; }
        go.disabled = true; note.className = 'th-pop__note'; note.textContent = '';
        fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: v, firstName: first ? (first.value || '').trim() : undefined, phone: phone && (phone.value || '').trim() ? phone.value.trim() : undefined, smsConsent: !!(sms && sms.checked && phone && (phone.value || '').trim()), source: 'popup', formId: cfg.id }) })
          .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ return { ok: r.ok, j: j }; }); })
          .then(function(res){
            if (res.ok && res.j.ok) {
              setCookie('th_sub', '1', 3650);
              form.innerHTML = '<div class="th-pop__done"><div class="th-pop__h" style="font-size:22px">' + esc(s.successHeadline || 'You are on the list.') + '</div><p class="th-pop__p">' + esc(s.successBody || 'Check your inbox for your code.') + '</p></div>';
              note.textContent = '';
              setTimeout(close, 2600);
            } else { note.textContent = res.j.error || 'Could not sign you up just now.'; note.className = 'th-pop__note err'; go.disabled = false; }
          })
          .catch(function(){ note.textContent = 'Could not sign you up just now.'; note.className = 'th-pop__note err'; go.disabled = false; });
      });
    }
    function arm(cfg){
      var s = cfg.settings || {};
      var fired = false;
      function once(){ if (fired) return; fired = true; show(cfg); }
      if (force) return once();
      var trig = s.trigger || 'delay';
      var mobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
      if (trig === 'exit' && !mobile) {
        document.addEventListener('mouseout', function(e){ if (!e.relatedTarget && e.clientY <= 0) once(); });
        setTimeout(once, Math.max(20, Number(s.delaySeconds) || 45) * 1000);
        return;
      }
      if (trig === 'scroll') {
        var pct = Math.min(95, Math.max(5, Number(s.scrollPercent) || 40));
        var onScroll = function(){ var h = document.documentElement; var p = (window.scrollY + window.innerHeight) / Math.max(1, h.scrollHeight) * 100; if (p >= pct) { once(); window.removeEventListener('scroll', onScroll); } };
        window.addEventListener('scroll', onScroll, { passive: true });
        return;
      }
      setTimeout(once, Math.max(0, Number(s.delaySeconds) || 6) * 1000);
    }
    var load = function(){
      fetch('/api/shop/forms', { credentials: 'same-origin' })
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(j){ if (j && j.popup) arm(j.popup); })
        .catch(function(){});
    };
    if (document.readyState === 'complete') setTimeout(load, 50); else window.addEventListener('load', function(){ setTimeout(load, 50); });
  }catch(e){}
})();`;
