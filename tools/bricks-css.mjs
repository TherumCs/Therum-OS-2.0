// Generate the Bricks stylesheet for sidemoney.co from the reference site.
//
// THE PORT LAW (PORTING.md): :10025 is truth, the target platform is Bricks,
// and NOTHING Elementor may survive. The previous approach imported the
// reference's Elementor stylesheet and taught our renderer to emit Elementor
// class names so it would match — pixels close, wrong platform, and every
// visual fix had a site-wide blast radius.
//
// This does the opposite. It reads what the browser COMPUTED for each element
// on the reference and writes those values against the class OUR markup already
// carries (`.el-<id>`, from the Bricks _cssClasses). The reference is the
// visual spec; none of its class vocabulary comes along.
//
// Two parts are emitted:
//   A. the reference's own THEME rules — every rule whose selector mentions no
//      Elementor token. These are the ideapark theme's classes (c-header__*,
//      c-ip-*, l-*), which our ported markup already carries.
//   B. generated `.el-<id>` rules from computed styles, at each breakpoint.
//
// Anything Elementor is dropped on the floor in both parts.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REFERENCE = process.env.REFERENCE_ORIGIN ?? 'http://localhost:10025';
const OUT = process.env.BRICKS_CSS_OUT ?? '/tmp/bricks.css';

const PAGES = [
  '/', '/about-sidemoney/', '/faq/', '/contact/', '/contacts/',
  '/terms-and-conditions/', '/privacy-statement/', '/cookie-policy/',
  '/accessibility-statement/', '/refund_returns/', '/order-tracking/',
  '/maintenance-mode/', '/shop/', '/product/sevn-fold-snapback/', '/cart/',
  '/checkout/', '/my-account/', '/blog/', '/wishlist/',
];

// 1440 is the base; the narrower two become max-width media queries, which is
// the order the reference's own breakpoints are written in.
const BREAKPOINTS = [
  { width: 1440, media: null },
  { width: 1024, media: '@media (max-width:1024px)' },
  { width: 767, media: '@media (max-width:767px)' },
];

// Anything carrying an Elementor token is refused, in selectors and in the
// generated output. This is the check that enforces rule 2 mechanically rather
// than by care.
export const ELEMENTOR = /elementor|\be-con\b|\be-flex\b|\be-child\b|\be-parent\b|\be-grid\b/i;

// The properties that decide layout and appearance. Deliberately explicit: a
// full computed-style dump is ~340 properties per element and most are noise
// that would bury the real values and bloat the file past usefulness.
const PROPS = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'clear',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content',
  'align-self', 'flex-grow', 'flex-shrink', 'flex-basis', 'order',
  'grid-template-columns', 'grid-template-rows', 'grid-auto-flow', 'grid-column', 'grid-row',
  'row-gap', 'column-gap',
  'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height', 'aspect-ratio',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'box-sizing', 'overflow-x', 'overflow-y', 'visibility', 'opacity',
  'background-color', 'background-image', 'background-size', 'background-position',
  'background-repeat', 'background-attachment', 'mix-blend-mode',
  'color', 'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-align', 'text-transform', 'text-decoration-line',
  'white-space', 'text-overflow',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-left-radius', 'border-bottom-right-radius',
  'box-shadow', 'transform', 'transform-origin', 'object-fit', 'object-position',
  'list-style-type', 'cursor',
];

// Values worth omitting: they are what the element would compute anyway, and
// writing them back adds bytes without changing a pixel.
const NOISE = new Set([
  'auto', 'none', 'normal', 'static', 'visible', '0px', '0', '1', 'baseline', 'stretch',
  'rgba(0, 0, 0, 0)', 'start', 'nowrap', 'row', 'content-box', 'repeat', 'medium',
  'currentcolor', '50% 50%', '0% 0%', 'disc', 'scroll', 'left top',
]);

async function connect(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p) return p.webSocketDebuggerUrl;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('chrome never came up');
}

const COLLECT = (props) => `(() => {
  const PROPS = ${JSON.stringify(props)};
  const out = {};
  document.querySelectorAll('[class*="elementor-element-"]').forEach((el) => {
    const id = ((el.className || '').toString().match(/elementor-element-([0-9a-f]+)/) || [])[1];
    if (!id || out[id]) return;
    const cs = getComputedStyle(el);
    const v = {};
    for (const p of PROPS) { const x = cs.getPropertyValue(p); if (x) v[p] = x.trim(); }
    out[id] = v;
  });
  return JSON.stringify(out);
})()`;

// Rules from the reference whose selector mentions nothing Elementor: the
// theme's own CSS, which our ported markup already carries the classes for.
const THEME_RULES = `(() => {
  const keep = [];
  const bad = /elementor|\\be-con\\b|\\be-flex\\b|\\be-child\\b|\\be-parent\\b|\\be-grid\\b/i;
  for (const sheet of document.styleSheets) {
    let rules = null; try { rules = sheet.cssRules } catch { continue }
    if (!rules) continue;
    for (const r of rules) {
      const t = r.cssText;
      if (!t || bad.test(t.split('{')[0])) continue;
      // A media block is kept only if none of its selectors are Elementor's.
      if (r.constructor.name === 'CSSMediaRule' && bad.test(t)) continue;
      keep.push(t);
    }
  }
  return JSON.stringify(keep);
})()`;

export async function build() {
  const profile = mkdtempSync(join(tmpdir(), 'bx-'));
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--remote-debugging-port=9551', `--user-data-dir=${profile}`,
     '--no-first-run', '--use-gl=angle', '--use-angle=swiftshader', '--hide-scrollbars', 'about:blank'],
    { stdio: 'ignore' });
  const ws = new WebSocket(await connect(9551));
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const waiting = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Page.enable'); await send('Runtime.enable');

  // { id: { width: {prop: value} } }
  const styles = {};
  const theme = new Set();

  for (const path of PAGES) {
    for (const bp of BREAKPOINTS) {
      await send('Emulation.setDeviceMetricsOverride', { width: bp.width, height: 900, deviceScaleFactor: 1, mobile: bp.width < 768 });
      await send('Page.navigate', { url: REFERENCE + path });
      await new Promise((r) => setTimeout(r, 2600));
      const got = JSON.parse((await evaluate(COLLECT(PROPS))) || '{}');
      for (const [eid, v] of Object.entries(got)) {
        (styles[eid] ??= {})[bp.width] = v;
      }
      if (bp.width === 1440) {
        for (const t of JSON.parse((await evaluate(THEME_RULES)) || '[]')) theme.add(t);
      }
    }
    console.log(`${path.padEnd(34)} ids=${Object.keys(styles).length} themeRules=${theme.size}`);
  }
  chrome.kill(); ws.close();

  // ---- emit ----
  const decl = (v) => Object.entries(v)
    .filter(([p, x]) => x && !NOISE.has(x) && !(p === 'font-family' && !x))
    .map(([p, x]) => `${p}:${x}`)
    .join(';');

  const out = [
    '/* Bricks stylesheet for sidemoney.co — generated from localhost:10025.',
    '   See PORTING.md. Every selector here is one of OUR Bricks classes; the',
    '   legacy builder vocabulary is refused by tools/bricks-css.mjs, which',
    '   exits non-zero if any reaches this file. */',
    '',
    '/* --- theme rules carried over from the reference --- */',
    ...[...theme],
    '',
    '/* --- per-element values, keyed to the Bricks class our markup carries --- */',
  ];

  let generated = 0;
  for (const [eid, byWidth] of Object.entries(styles)) {
    const base = byWidth[1440];
    if (!base) continue;
    const b = decl(base);
    if (b) { out.push(`.el-${eid}{${b}}`); generated++; }
    // Narrower breakpoints emit only what actually changes.
    for (const bp of BREAKPOINTS.slice(1)) {
      const v = byWidth[bp.width];
      if (!v) continue;
      const diff = {};
      for (const [p, x] of Object.entries(v)) if (base[p] !== x) diff[p] = x;
      const d = decl(diff);
      if (d) out.push(`${bp.media}{.el-${eid}{${d}}}`);
    }
  }

  const css = out.join('\n');
  // Comments are prose, not selectors — strip them before judging, or the
  // note explaining that the vocabulary is absent trips the check that proves
  // it is absent.
  const offenders = css.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => ELEMENTOR.test((l.split('{')[0] || '')));
  writeFileSync(OUT, css);
  console.log(`\nelements styled : ${generated}`);
  console.log(`theme rules kept: ${theme.size}`);
  console.log(`bytes           : ${css.length}`);
  console.log(`ELEMENTOR SELECTORS IN OUTPUT: ${offenders.length} ${offenders.length ? '<-- MUST BE 0' : '(clean)'}`);
  return { css, offenders: offenders.length };
}

const invoked = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invoked || process.env.BRICKS_CSS_RUN) {
  const r = await build();
  process.exit(r.offenders ? 1 : 0);
}
