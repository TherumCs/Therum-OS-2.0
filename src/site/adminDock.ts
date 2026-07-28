import type { AdminDock } from '../services/settings.service.js';

// Front-end admin dock — 2.0's port of 1.9.44's Therum OS Admin Dock
// (mu-plugins/therum-admin.php, the `thd_*` block).
//
// Same three settings Settings > Admin Dock already stored and nothing read:
// position (bottom|top), default mode (scroll|always|drawer), mobile (fab|none).
// Same behaviours: auto-hide on scroll down / return on scroll up, a pull-tab
// drawer, focus mode for demos, and a breadcrumb + Edit link for the page you
// are looking at.
//
// Two deliberate differences from 1.9.44, both because the platform changed:
//   - Edit goes to the Bricks builder when the page came in through the Bricks
//     Bridge, and to the 2.0 editor otherwise. 1.9.44 could assume WordPress.
//   - The 5 pinnable shortcut slots are not ported. They persisted to WP user
//     meta via admin-ajax; there is no equivalent per-user store wired to the
//     public site yet, and a row of slots that forget themselves on reload is
//     worse than no row at all.

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
#thd-bar.thd-focus{opacity:0;pointer-events:none}
.thd-logo{display:flex;align-items:center;gap:7px;color:#fff;text-decoration:none;font-weight:650;white-space:nowrap}
.thd-logo:hover{color:#fff}
.thd-sep{opacity:.3}
.thd-crumb{opacity:.72;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.thd-spacer{flex:1;min-width:12px}
.thd-actions{display:flex;align-items:center;gap:6px}
.thd-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 11px;border-radius:9px;
  border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.07);color:#e8e8ea;
  font:inherit;font-weight:550;cursor:pointer;text-decoration:none;white-space:nowrap}
.thd-btn:hover{background:rgba(255,255,255,.16);color:#fff}
.thd-btn[aria-pressed="true"]{background:#fff;color:#111;border-color:#fff}
.thd-mode-wrap{position:relative}
.thd-mode-panel{position:absolute;right:0;min-width:250px;padding:6px;border-radius:12px;
  background:rgba(28,30,36,.98);border:1px solid rgba(255,255,255,.12);box-shadow:0 12px 40px rgba(0,0,0,.4);
  display:none}
#thd-bar[data-pos="bottom"] .thd-mode-panel{bottom:40px}
#thd-bar[data-pos="top"] .thd-mode-panel{top:40px}
.thd-mode-panel.open{display:block}
.thd-mode-header{font-size:10px;text-transform:uppercase;letter-spacing:.07em;opacity:.5;padding:8px 10px 4px}
.thd-mode-opt,.thd-pos-opt{display:flex;align-items:flex-start;gap:9px;width:100%;padding:8px 10px;border:0;
  border-radius:8px;background:none;color:#e8e8ea;font:inherit;text-align:left;cursor:pointer}
.thd-mode-opt:hover,.thd-pos-opt:hover{background:rgba(255,255,255,.09)}
.thd-mode-dot{width:7px;height:7px;margin-top:5px;border-radius:50%;background:rgba(255,255,255,.25);flex:none}
.thd-mode-opt.active .thd-mode-dot,.thd-pos-opt.active .thd-mode-dot{background:#e83b3b}
.thd-mode-name{font-weight:600;font-size:12.5px}
.thd-mode-desc{font-size:11px;opacity:.55;margin-top:2px;line-height:1.35}
.thd-mode-rule{height:1px;background:rgba(255,255,255,.1);margin:5px 0}
.thd-user{display:flex;align-items:center;gap:7px;padding-left:10px;margin-left:2px;
  border-left:1px solid rgba(255,255,255,.12)}
.thd-avatar{width:24px;height:24px;border-radius:50%;background:#e83b3b;color:#fff;display:grid;place-items:center;
  font-size:11px;font-weight:700}
/* Drawer pull-tab — the only thing visible in drawer mode. */
#thd-tab{position:fixed;left:50%;transform:translateX(-50%);z-index:99998;display:none;
  width:52px;height:20px;border:0;border-radius:8px 8px 0 0;cursor:pointer;
  background:rgba(22,24,30,.86);color:#e8e8ea;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
#thd-tab[data-pos="bottom"]{bottom:0}
#thd-tab[data-pos="top"]{top:0;border-radius:0 0 8px 8px}
#thd-tab.show{display:block}
@media (max-width:720px){
  .thd-crumb,.thd-logo span,.thd-btn span{display:none}
  #thd-bar{gap:6px;padding:0 10px}
  #thd-bar[data-mobile="none"]{display:none}
}`;
}

export function dockMarkup(ctx: DockContext): string {
  const { position, defaultMode, mobileStyle } = ctx.settings;
  const initial = ctx.username.trim().charAt(0).toUpperCase() || '?';
  const modeOpt = (mode: string, name: string, desc: string): string =>
    `<button class="thd-mode-opt${defaultMode === mode ? ' active' : ''}" data-mode="${mode}" role="menuitem">
      <span class="thd-mode-dot"></span><div><div class="thd-mode-name">${name}</div><div class="thd-mode-desc">${desc}</div></div>
    </button>`;
  const posOpt = (pos: string, name: string, desc: string): string =>
    `<button class="thd-pos-opt${position === pos ? ' active' : ''}" data-position="${pos}" role="menuitem">
      <span class="thd-mode-dot"></span><div><div class="thd-mode-name">${name}</div><div class="thd-mode-desc">${desc}</div></div>
    </button>`;

  return `<div id="thd-bar" role="navigation" aria-label="Therum OS admin dock"
  data-pos="${esc(position)}" data-default-mode="${esc(defaultMode)}" data-mobile="${esc(mobileStyle)}">
  <a href="/tos-admin" class="thd-logo" title="Dashboard">${ICON.logo}<span>Therum OS</span></a>
  <span class="thd-sep" aria-hidden="true">/</span>
  <span class="thd-crumb">${esc(ctx.crumb)}</span>
  <div class="thd-spacer"></div>
  <div class="thd-actions">
    ${ctx.editUrl ? `<a href="${esc(ctx.editUrl)}" class="thd-btn" title="Edit this page">${ICON.edit}<span>Edit</span></a>` : ''}
    <a href="/tos-admin/pages" class="thd-btn" title="New page">${ICON.plus}<span>New</span></a>
    <div class="thd-mode-wrap">
      <button class="thd-btn" id="thd-mode-btn" title="Display mode" aria-expanded="false">
        ${ICON.mode}<span id="thd-mode-label"></span>${ICON.chevup}
      </button>
      <div class="thd-mode-panel" id="thd-mode-panel" role="menu">
        <div class="thd-mode-header">Display mode</div>
        ${modeOpt('always', 'Always on', 'Dock stays visible at all times')}
        ${modeOpt('scroll', 'Auto-hide', 'Hides on scroll down, returns on scroll up')}
        ${modeOpt('drawer', 'Drawer', 'Hidden — pull-tab opens it on demand')}
        <div class="thd-mode-rule"></div>
        <div class="thd-mode-header">Position</div>
        ${posOpt('bottom', 'Bottom dock', 'macOS-style, below the content')}
        ${posOpt('top', 'Top bar', 'Classic toolbar position')}
      </div>
    </div>
    <button class="thd-btn" id="thd-focus-btn" title="Focus mode — hides the dock for demos" aria-pressed="false">
      ${ICON.focus}<span>Focus</span>
    </button>
    <button class="thd-btn" id="thd-collapse-btn" title="Collapse to drawer">${ICON.chevdown}</button>
    <span class="thd-user"><span class="thd-avatar">${esc(initial)}</span></span>
  </div>
</div>
<button id="thd-tab" data-pos="${esc(position)}" aria-label="Open admin dock"></button>`;
}

// Behaviour. Mode and position changes persist through the same PATCH the
// Settings > Admin Dock page uses, so the dock and that page are never out of
// step — 1.9.44 did the same thing through admin-ajax + update_option.
export function dockScript(): string {
  return `(function(){
var bar=document.getElementById('thd-bar'), tab=document.getElementById('thd-tab');
if(!bar) return;
var LABEL={always:'Always on',scroll:'Auto-hide',drawer:'Drawer'};
var mode=bar.dataset.defaultMode||'scroll', pos=bar.dataset.pos||'bottom';
var label=document.getElementById('thd-mode-label');
var panel=document.getElementById('thd-mode-panel');
var modeBtn=document.getElementById('thd-mode-btn');

function save(body){
  fetch('/tos-admin/api/settings/admin-dock',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).catch(function(){});
}
function applyMode(m){
  mode=m; if(label) label.textContent=LABEL[m]||m;
  bar.classList.toggle('thd-hidden', m==='drawer');
  if(tab) tab.classList.toggle('show', m==='drawer');
  [].forEach.call(panel?panel.querySelectorAll('.thd-mode-opt'):[],function(b){ b.classList.toggle('active', b.dataset.mode===m); });
}
function applyPos(p){
  pos=p; bar.dataset.pos=p; if(tab) tab.dataset.pos=p;
  [].forEach.call(panel?panel.querySelectorAll('.thd-pos-opt'):[],function(b){ b.classList.toggle('active', b.dataset.position===p); });
}
applyMode(mode); applyPos(pos);

if(modeBtn) modeBtn.addEventListener('click',function(e){
  e.stopPropagation();
  var open=panel.classList.toggle('open');
  modeBtn.setAttribute('aria-expanded', open?'true':'false');
});
document.addEventListener('click',function(e){
  if(panel&&panel.classList.contains('open')&&!panel.contains(e.target)){ panel.classList.remove('open'); if(modeBtn) modeBtn.setAttribute('aria-expanded','false'); }
});
if(panel){
  panel.addEventListener('click',function(e){
    var m=e.target.closest('.thd-mode-opt'), p=e.target.closest('.thd-pos-opt');
    if(m){ applyMode(m.dataset.mode); save({defaultMode:m.dataset.mode}); }
    if(p){ applyPos(p.dataset.position); save({position:p.dataset.position}); }
  });
}

var collapse=document.getElementById('thd-collapse-btn');
if(collapse) collapse.addEventListener('click',function(){ applyMode('drawer'); save({defaultMode:'drawer'}); });
if(tab) tab.addEventListener('click',function(){ applyMode('scroll'); save({defaultMode:'scroll'}); });

// Focus mode is a demo affordance, deliberately NOT persisted — 1.9.44 keeps
// it per-page-view too. Escape brings the dock back.
var focusBtn=document.getElementById('thd-focus-btn');
if(focusBtn) focusBtn.addEventListener('click',function(){
  var on=bar.classList.toggle('thd-focus');
  focusBtn.setAttribute('aria-pressed', on?'true':'false');
});
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'&&bar.classList.contains('thd-focus')){
    bar.classList.remove('thd-focus');
    if(focusBtn) focusBtn.setAttribute('aria-pressed','false');
  }
});

// Auto-hide: down hides, up shows. Only in scroll mode.
var lastY=window.scrollY;
window.addEventListener('scroll',function(){
  if(mode!=='scroll'){ lastY=window.scrollY; return; }
  var y=window.scrollY;
  if(Math.abs(y-lastY)>6) bar.classList.toggle('thd-hidden', y>lastY&&y>80);
  lastY=y;
},{passive:true});
})();`;
}
