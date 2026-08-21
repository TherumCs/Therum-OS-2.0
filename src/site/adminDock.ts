import type { AdminDock } from '../services/settings.service.js';

// Front-end admin dock — 2.0's port of 1.9.44's Therum OS Admin Dock
// (mu-plugins/therum-admin.php, the `thd_*` block), grown into the "admin lens".
//
// When a signed-in operator browses the public site the dock rides on EVERY
// page. It has two views and three skins, all reachable without leaving the page:
//   - View: "Admin lens" (the full dock, all controls) <-> "Front end" (collapses
//     to a small pill so you see the site as a visitor). The pill is always
//     visible in front-end view — click it to bring the lens back. This is the
//     answer to "how do I get it back after I hide it": the pill, or (from Focus)
//     the corner restore button / Escape.
//   - Style: 'bar' (compact floating bar), 'large' (a bigger floating bar),
//     'dock' (a macOS-style icon dock that lifts on hover). Persisted.
//   - Plus the ported behaviours: auto-hide on scroll, drawer pull-tab, top/bottom
//     position, and Focus (a total hide for demos/screenshots).
//
// Settings persisted through the same PATCH the Settings > Admin Dock page uses
// (position, defaultMode, mobileStyle, style). The front-end/admin VIEW and Focus
// are per-view (localStorage / ephemeral) — they are a "right now" choice, not a
// stored preference.

export interface DockContext {
  /** Page title for the breadcrumb. */
  crumb: string;
  /** Admin edit URL for this page, or null when it is not editable. */
  editUrl: string | null;
  /** Signed-in user's display name. */
  username: string;
  settings: AdminDock;
}

const ICON = {
  logo: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  edit: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',
  plus: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  focus: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg>',
  eye: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  mode: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  chevdown: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
  chevup: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>',
};

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function dockStyles(): string {
  return `
#thd-bar{position:fixed;left:50%;transform:translateX(-50%);z-index:99999;display:flex;align-items:center;gap:10px;
  padding:0 14px;height:var(--thd-h,56px);max-width:calc(100vw - 32px);
  font:500 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;color:#e8e8ea;
  background:rgba(22,24,30,.86);border:1px solid rgba(255,255,255,.1);border-radius:14px;
  backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4);
  box-shadow:0 8px 30px rgba(0,0,0,.28);transition:transform .28s cubic-bezier(.4,0,.2,1),opacity .2s}
#thd-bar[data-pos="bottom"]{bottom:16px}
#thd-bar[data-pos="top"]{top:16px}
#thd-bar.thd-hidden[data-pos="bottom"]{transform:translateX(-50%) translateY(calc(100% + 24px))}
#thd-bar.thd-hidden[data-pos="top"]{transform:translateX(-50%) translateY(calc(-100% - 24px))}
#thd-bar.thd-focus{opacity:0;pointer-events:none;transform:translateX(-50%) scale(.96)}
/* Front-end view: the lens tucks away and the pill takes over. */
#thd-bar.thd-plain{opacity:0;pointer-events:none}
#thd-bar.thd-plain[data-pos="bottom"]{transform:translateX(-50%) translateY(calc(100% + 24px))}
#thd-bar.thd-plain[data-pos="top"]{transform:translateX(-50%) translateY(calc(-100% - 24px))}
.thd-logo{display:flex;align-items:center;gap:7px;color:#fff;text-decoration:none;font-weight:650;white-space:nowrap}
.thd-logo:hover{color:#fff}
.thd-sep{opacity:.3}
.thd-crumb{opacity:.72;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.thd-spacer{flex:1;min-width:12px}
.thd-actions{display:flex;align-items:center;gap:6px}
.thd-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 11px;border-radius:9px;
  border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.07);color:#e8e8ea;
  font:inherit;font-weight:550;cursor:pointer;text-decoration:none;white-space:nowrap;transition:transform .16s,background .16s}
.thd-btn:hover{background:rgba(255,255,255,.16);color:#fff}
.thd-btn[aria-pressed="true"]{background:#fff;color:#111;border-color:#fff}
.thd-uname{display:none;opacity:.72;font-weight:600;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.thd-mode-wrap{position:relative}
.thd-mode-panel{position:absolute;right:0;min-width:250px;padding:6px;border-radius:12px;
  background:rgba(28,30,36,.98);border:1px solid rgba(255,255,255,.12);box-shadow:0 12px 40px rgba(0,0,0,.4);
  display:none;max-height:70vh;overflow:auto}
#thd-bar[data-pos="bottom"] .thd-mode-panel{bottom:calc(var(--thd-h,56px) - 16px)}
#thd-bar[data-pos="top"] .thd-mode-panel{top:calc(var(--thd-h,56px) - 16px)}
.thd-mode-panel.open{display:block}
.thd-mode-header{font-size:10px;text-transform:uppercase;letter-spacing:.07em;opacity:.5;padding:8px 10px 4px}
.thd-mode-opt,.thd-pos-opt,.thd-style-opt{display:flex;align-items:flex-start;gap:9px;width:100%;padding:8px 10px;border:0;
  border-radius:8px;background:none;color:#e8e8ea;font:inherit;text-align:left;cursor:pointer}
.thd-mode-opt:hover,.thd-pos-opt:hover,.thd-style-opt:hover{background:rgba(255,255,255,.09)}
.thd-mode-dot{width:7px;height:7px;margin-top:5px;border-radius:50%;background:rgba(255,255,255,.25);flex:none}
.thd-mode-opt.active .thd-mode-dot,.thd-pos-opt.active .thd-mode-dot,.thd-style-opt.active .thd-mode-dot{background:#e83b3b}
.thd-mode-name{font-weight:600;font-size:12.5px}
.thd-mode-desc{font-size:11px;opacity:.55;margin-top:2px;line-height:1.35}
.thd-mode-rule{height:1px;background:rgba(255,255,255,.1);margin:5px 0}
.thd-user{display:flex;align-items:center;gap:7px;padding-left:10px;margin-left:2px;
  border-left:1px solid rgba(255,255,255,.12)}
.thd-avatar{width:24px;height:24px;border-radius:50%;background:#e83b3b;color:#fff;display:grid;place-items:center;
  font-size:11px;font-weight:700}

/* ── Style: LARGE ── a roomier floating bar. */
#thd-bar[data-style="large"]{--thd-h:72px;gap:14px;padding:0 20px;font-size:14px;border-radius:18px}
#thd-bar[data-style="large"] .thd-btn{height:40px;padding:0 15px;border-radius:11px;font-size:13.5px}
#thd-bar[data-style="large"] .thd-avatar{width:32px;height:32px;font-size:13px}
#thd-bar[data-style="large"] .thd-crumb{max-width:320px;font-size:14px}
#thd-bar[data-style="large"] .thd-uname{display:inline-block}
#thd-bar[data-style="large"] .thd-logo{font-size:15px}

/* ── Style: DOCK ── macOS-style icon dock; tiles lift on hover, labels/crumb drop. */
#thd-bar[data-style="dock"]{--thd-h:66px;gap:9px;padding:9px 13px;border-radius:22px;background:rgba(26,28,36,.72);align-items:flex-end}
#thd-bar[data-style="dock"] .thd-crumb,#thd-bar[data-style="dock"] .thd-sep,#thd-bar[data-style="dock"] .thd-spacer,#thd-bar[data-style="dock"] .thd-uname,#thd-bar[data-style="dock"] .thd-mode-label,#thd-bar[data-style="dock"] #thd-mode-btn .thd-chev{display:none}
#thd-bar[data-style="dock"] .thd-actions{gap:9px;align-items:flex-end}
#thd-bar[data-style="dock"] .thd-btn span,#thd-bar[data-style="dock"] .thd-logo span{display:none}
#thd-bar[data-style="dock"] .thd-btn,#thd-bar[data-style="dock"] .thd-logo{width:46px;height:46px;padding:0;justify-content:center;border-radius:13px;transform-origin:bottom center}
#thd-bar[data-style="dock"] .thd-btn:hover,#thd-bar[data-style="dock"] .thd-logo:hover{transform:translateY(-9px) scale(1.16);background:rgba(255,255,255,.2)}
#thd-bar[data-style="dock"] .thd-user{border-left:0;padding-left:0}
#thd-bar[data-style="dock"] .thd-avatar{width:44px;height:44px;font-size:16px;border-radius:13px;transform-origin:bottom center;transition:transform .16s}
#thd-bar[data-style="dock"] .thd-user:hover .thd-avatar{transform:translateY(-9px) scale(1.12)}
#thd-bar[data-style="dock"][data-pos="top"]{align-items:flex-start}
#thd-bar[data-style="dock"][data-pos="top"] .thd-btn:hover,#thd-bar[data-style="dock"][data-pos="top"] .thd-logo:hover,#thd-bar[data-style="dock"][data-pos="top"] .thd-user:hover .thd-avatar{transform:translateY(9px) scale(1.16)}
#thd-bar[data-style="dock"] .thd-btn,#thd-bar[data-style="dock"] .thd-logo,#thd-bar[data-style="dock"] .thd-avatar{transform-origin:bottom center}
#thd-bar[data-style="dock"][data-pos="top"] .thd-btn,#thd-bar[data-style="dock"][data-pos="top"] .thd-logo,#thd-bar[data-style="dock"][data-pos="top"] .thd-avatar{transform-origin:top center}

/* ── Front-end pill ── the always-there way back into the lens. */
#thd-pill{position:fixed;left:50%;transform:translateX(-50%) scale(.9);z-index:99998;display:none;align-items:center;gap:8px;
  height:34px;padding:0 13px 0 11px;border-radius:999px;cursor:pointer;opacity:0;
  background:rgba(22,24,30,.86);border:1px solid rgba(255,255,255,.13);color:#e8e8ea;
  font:650 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;
  backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4);
  box-shadow:0 6px 20px rgba(0,0,0,.25);transition:opacity .2s,transform .2s}
#thd-pill[data-pos="bottom"]{bottom:14px}
#thd-pill[data-pos="top"]{top:14px}
#thd-pill.show{display:flex;opacity:1;transform:translateX(-50%) scale(1)}
#thd-pill:hover{border-color:rgba(255,255,255,.28)}
.thd-pill-dot{width:8px;height:8px;border-radius:50%;background:#e83b3b;flex:none;box-shadow:0 0 0 3px rgba(232,59,59,.22)}

/* ── Drawer pull-tab (scroll-mode "drawer") ── */
#thd-tab{position:fixed;left:50%;transform:translateX(-50%);z-index:99997;display:none;
  width:52px;height:20px;border:0;border-radius:8px 8px 0 0;cursor:pointer;
  background:rgba(22,24,30,.86);color:#e8e8ea;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
#thd-tab[data-pos="bottom"]{bottom:0}
#thd-tab[data-pos="top"]{top:0;border-radius:0 0 8px 8px}
#thd-tab.show{display:block}

/* ── Focus restore ── a faint corner button so Focus is never a dead end. */
#thd-restore{position:fixed;z-index:99997;display:none;width:34px;height:34px;border:0;border-radius:10px;cursor:pointer;
  background:rgba(22,24,30,.55);color:rgba(255,255,255,.6);align-items:center;justify-content:center;
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);opacity:.45;transition:opacity .2s,color .2s}
#thd-restore:hover{opacity:1;color:#fff;background:rgba(22,24,30,.8)}
#thd-restore[data-pos="bottom"]{right:16px;bottom:16px}
#thd-restore[data-pos="top"]{right:16px;top:16px}
#thd-restore.show{display:flex}

@media (max-width:720px){
  .thd-crumb,.thd-logo span,.thd-btn span,.thd-uname{display:none}
  #thd-bar{gap:6px;padding:0 10px}
  #thd-bar[data-style="large"]{--thd-h:60px;padding:0 12px}
  #thd-bar[data-mobile="none"]{display:none}
  /* "fab" — a single round button until tapped. */
  #thd-bar[data-mobile="fab"]:not([data-style="dock"]){width:48px;height:48px;padding:0;gap:0;border-radius:50%;
    justify-content:center;overflow:hidden}
  #thd-bar[data-mobile="fab"]:not([data-style="dock"]) > *{display:none}
  #thd-bar[data-mobile="fab"]:not([data-style="dock"]) > .thd-logo{display:flex}
  #thd-bar[data-mobile="fab"].thd-fab-open{width:auto;max-width:calc(100vw - 32px);
    height:var(--thd-h,56px);padding:0 10px;gap:6px;border-radius:14px;overflow:visible}
  #thd-bar[data-mobile="fab"].thd-fab-open > *{display:flex}
}`;
}

export function dockMarkup(ctx: DockContext): string {
  const { position, defaultMode, mobileStyle, style } = ctx.settings;
  const initial = ctx.username.trim().charAt(0).toUpperCase() || '?';
  const modeOpt = (mode: string, name: string, desc: string): string =>
    `<button class="thd-mode-opt${defaultMode === mode ? ' active' : ''}" data-mode="${mode}" role="menuitem">
      <span class="thd-mode-dot"></span><div><div class="thd-mode-name">${name}</div><div class="thd-mode-desc">${desc}</div></div>
    </button>`;
  const posOpt = (pos: string, name: string, desc: string): string =>
    `<button class="thd-pos-opt${position === pos ? ' active' : ''}" data-position="${pos}" role="menuitem">
      <span class="thd-mode-dot"></span><div><div class="thd-mode-name">${name}</div><div class="thd-mode-desc">${desc}</div></div>
    </button>`;
  const styleOpt = (st: string, name: string, desc: string): string =>
    `<button class="thd-style-opt${style === st ? ' active' : ''}" data-style-opt="${st}" role="menuitem">
      <span class="thd-mode-dot"></span><div><div class="thd-mode-name">${name}</div><div class="thd-mode-desc">${desc}</div></div>
    </button>`;

  return `<div id="thd-bar" role="navigation" aria-label="Therum OS admin dock"
  data-pos="${esc(position)}" data-default-mode="${esc(defaultMode)}" data-mobile="${esc(mobileStyle)}" data-style="${esc(style)}">
  <a href="/tos-admin" class="thd-logo" title="Dashboard">${ICON.logo}<span>Therum OS</span></a>
  <span class="thd-sep" aria-hidden="true">/</span>
  <span class="thd-crumb">${esc(ctx.crumb)}</span>
  <div class="thd-spacer"></div>
  <span class="thd-uname">${esc(ctx.username)}</span>
  <div class="thd-actions">
    ${ctx.editUrl ? `<a href="${esc(ctx.editUrl)}" class="thd-btn" title="Edit this page">${ICON.edit}<span>Edit</span></a>` : ''}
    <a href="/tos-admin/pages" class="thd-btn" title="New page">${ICON.plus}<span>New</span></a>
    <div class="thd-mode-wrap">
      <button class="thd-btn" id="thd-mode-btn" title="Dock style &amp; display" aria-expanded="false">
        ${ICON.mode}<span class="thd-mode-label" id="thd-mode-label"></span><span class="thd-chev">${ICON.chevup}</span>
      </button>
      <div class="thd-mode-panel" id="thd-mode-panel" role="menu">
        <div class="thd-mode-header">Style</div>
        ${styleOpt('bar', 'Floating bar', 'Compact frosted bar')}
        ${styleOpt('large', 'Large bar', 'Bigger, with your name')}
        ${styleOpt('dock', 'macOS dock', 'Icon dock, lifts on hover')}
        <div class="thd-mode-rule"></div>
        <div class="thd-mode-header">Display mode</div>
        ${modeOpt('always', 'Always on', 'Dock stays visible at all times')}
        ${modeOpt('scroll', 'Auto-hide', 'Hides on scroll down, returns on scroll up')}
        ${modeOpt('drawer', 'Drawer', 'Hidden — pull-tab opens it on demand')}
        <div class="thd-mode-rule"></div>
        <div class="thd-mode-header">Position</div>
        ${posOpt('bottom', 'Bottom', 'macOS-style, below the content')}
        ${posOpt('top', 'Top', 'Classic toolbar position')}
      </div>
    </div>
    <button class="thd-btn" id="thd-view-btn" title="View the front end — collapse to a pill">
      ${ICON.eye}<span>View site</span>
    </button>
    <button class="thd-btn" id="thd-focus-btn" title="Focus — hide the dock for demos (Esc to bring back)" aria-pressed="false">
      ${ICON.focus}<span>Focus</span>
    </button>
    <span class="thd-user"><span class="thd-avatar">${esc(initial)}</span></span>
  </div>
</div>
<button id="thd-pill" data-pos="${esc(position)}" title="Open the admin lens" aria-label="Open the Therum OS admin lens">
  <span class="thd-pill-dot"></span>${ICON.logo}<span>Admin</span>
</button>
<button id="thd-tab" data-pos="${esc(position)}" aria-label="Open admin dock"></button>
<button id="thd-restore" data-pos="${esc(position)}" title="Show admin dock (Esc)" aria-label="Show admin dock">${ICON.logo}</button>`;
}

// Behaviour. Style/mode/position persist through the same PATCH the Settings >
// Admin Dock page uses, so the dock and that page never drift. The front-end vs
// admin VIEW persists in localStorage (a per-device "right now" choice, applied
// on every page). Focus is ephemeral, per-page-view.
export function dockScript(): string {
  return `(function(){
var bar=document.getElementById('thd-bar'), tab=document.getElementById('thd-tab');
var pill=document.getElementById('thd-pill'), restore=document.getElementById('thd-restore');
if(!bar) return;
var LABEL={always:'Always on',scroll:'Auto-hide',drawer:'Drawer'};
var mode=bar.dataset.defaultMode||'scroll', pos=bar.dataset.pos||'bottom', style=bar.dataset.style||'bar';
var label=document.getElementById('thd-mode-label');
var panel=document.getElementById('thd-mode-panel');
var modeBtn=document.getElementById('thd-mode-btn');
var VIEW_KEY='thd_view';

// Mobile "fab": the dock is a single round button until tapped.
bar.addEventListener('click',function(e){
  if(bar.dataset.mobile!=='fab'||window.innerWidth>720||style==='dock') return;
  if(bar.classList.contains('thd-fab-open')) return;
  e.preventDefault(); e.stopPropagation();
  bar.classList.add('thd-fab-open');
},true);
document.addEventListener('click',function(e){
  if(bar.dataset.mobile!=='fab') return;
  if(!bar.contains(e.target)) bar.classList.remove('thd-fab-open');
});

function save(body){
  fetch('/tos-admin/api/settings/admin-dock',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).catch(function(){});
}
function applyMode(m){
  mode=m; if(label) label.textContent=LABEL[m]||m;
  bar.classList.toggle('thd-hidden', m==='drawer' && !bar.classList.contains('thd-plain'));
  if(tab) tab.classList.toggle('show', m==='drawer' && !bar.classList.contains('thd-plain'));
  [].forEach.call(panel?panel.querySelectorAll('.thd-mode-opt'):[],function(b){ b.classList.toggle('active', b.dataset.mode===m); });
}
function applyPos(p){
  pos=p; bar.dataset.pos=p;
  if(tab) tab.dataset.pos=p; if(pill) pill.dataset.pos=p; if(restore) restore.dataset.pos=p;
  [].forEach.call(panel?panel.querySelectorAll('.thd-pos-opt'):[],function(b){ b.classList.toggle('active', b.dataset.position===p); });
}
function applyStyle(s){
  style=s; bar.dataset.style=s;
  [].forEach.call(panel?panel.querySelectorAll('.thd-style-opt'):[],function(b){ b.classList.toggle('active', b.dataset.styleOpt===s); });
}
// View = front-end (plain, pill showing) or admin (lens). Persisted per device.
function applyView(v){
  var plain = v==='plain';
  bar.classList.toggle('thd-plain', plain);
  if(pill) pill.classList.toggle('show', plain);
  // re-run mode so the drawer tab never fights the pill
  applyMode(mode);
  try{ localStorage.setItem(VIEW_KEY, v); }catch(e){}
}
applyStyle(style); applyPos(pos); applyMode(mode);
var startView='lens';
try{ if(localStorage.getItem(VIEW_KEY)==='plain') startView='plain'; }catch(e){}
applyView(startView);

if(modeBtn) modeBtn.addEventListener('click',function(e){
  e.stopPropagation();
  var open=panel.classList.toggle('open');
  modeBtn.setAttribute('aria-expanded', open?'true':'false');
});
document.addEventListener('click',function(e){
  if(panel&&panel.classList.contains('open')&&!panel.contains(e.target)&&e.target!==modeBtn){ panel.classList.remove('open'); if(modeBtn) modeBtn.setAttribute('aria-expanded','false'); }
});
if(panel){
  panel.addEventListener('click',function(e){
    var m=e.target.closest('.thd-mode-opt'), p=e.target.closest('.thd-pos-opt'), s=e.target.closest('.thd-style-opt');
    if(m){ applyMode(m.dataset.mode); save({defaultMode:m.dataset.mode}); }
    if(p){ applyPos(p.dataset.position); save({position:p.dataset.position}); }
    if(s){ applyStyle(s.dataset.styleOpt); save({style:s.dataset.styleOpt}); }
  });
}

// View site -> pill. Pill -> back to the lens.
var viewBtn=document.getElementById('thd-view-btn');
if(viewBtn) viewBtn.addEventListener('click',function(){ applyView('plain'); });
if(pill) pill.addEventListener('click',function(){ applyView('lens'); });

// Drawer tab still returns to auto-hide (a display-mode choice, not the view).
if(tab) tab.addEventListener('click',function(){ applyMode('scroll'); save({defaultMode:'scroll'}); });

// Focus = total hide for demos. Restore via Esc OR the corner button.
var focusBtn=document.getElementById('thd-focus-btn');
function setFocus(on){
  bar.classList.toggle('thd-focus', on);
  if(restore) restore.classList.toggle('show', on);
  if(pill && on) pill.classList.remove('show');
  else if(pill && !bar.classList.contains('thd-plain')) { /* pill only in plain view */ }
  if(focusBtn) focusBtn.setAttribute('aria-pressed', on?'true':'false');
}
if(focusBtn) focusBtn.addEventListener('click',function(){ setFocus(!bar.classList.contains('thd-focus')); });
if(restore) restore.addEventListener('click',function(){ setFocus(false); if(bar.classList.contains('thd-plain')&&pill) pill.classList.add('show'); });
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'&&bar.classList.contains('thd-focus')){ setFocus(false); if(bar.classList.contains('thd-plain')&&pill) pill.classList.add('show'); }
});

// Auto-hide: down hides, up shows. Only in scroll mode + admin (lens) view.
var lastY=window.scrollY;
window.addEventListener('scroll',function(){
  if(mode!=='scroll'||bar.classList.contains('thd-plain')||bar.classList.contains('thd-focus')){ lastY=window.scrollY; return; }
  var y=window.scrollY;
  if(Math.abs(y-lastY)>6) bar.classList.toggle('thd-hidden', y>lastY&&y>80);
  lastY=y;
},{passive:true});
})();`;
}
