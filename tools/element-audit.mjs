// Element-level audit: every Elementor element on every page, ours vs the
// reference site, at desktop / tablet / mobile.
//
// The section-level comparator only sees top-level blocks, so a marquee whose
// text overlaps itself or a two-column band that renders as unstyled 12px text
// both pass it — the section is still the right height. This walks every
// element that carries an id and reports each one that differs, which is the
// difference between "the page is 2% off" and "these nine elements are wrong".
//
// Forge, Bug/QA reporting: findings are specific, explain why, and are never
// invented. Every row here is a measurement of both sites, not a judgement.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REFERENCE = process.env.REFERENCE_ORIGIN ?? 'http://localhost:8080';
const OURS = process.env.SITE_ORIGIN ?? process.env.PUBLIC_ORIGIN ?? '';
// Every page that exists on both sides. Only pages with a counterpart on the
// reference belong here — auditing a page against an unrelated one would invent
// findings. Edit these mappings for the site being compared.
const PAGES = [
  ['/', '/'],
  ['/about', '/about/'],
  ['/faq', '/faq/'],
  ['/contact', '/contact/'],
  ['/terms-and-conditions', '/terms-and-conditions/'],
  ['/privacy-statement', '/privacy-statement/'],
  ['/cookie-policy', '/cookie-policy/'],
  ['/accessibility-statement', '/accessibility-statement/'],
  ['/refund_returns', '/refund_returns/'],
  ['/order-tracking', '/order-tracking/'],
  ['/shop', '/shop/'],
  ['/blog', '/blog/'],
];
const WIDTHS = [1440, 768, 390];
const TOL = 0.08; // 8% of the reference dimension

async function connect(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p) return p.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('chrome never came up');
}

// Geometry AND the text-overflow signal. A marquee whose copies stack on top of
// each other measures the right height while being unreadable, so scrollWidth
// vs clientWidth is captured too — that is what catches text piled on itself.
const PROBE = `(() => {
  const out = {};
  // The reference names elements with the old builder's class; ours carries
  // the Bricks class el-<id>. Same id, two vocabularies — match on both or
  // every element on our side reads as absent.
  document.querySelectorAll('[class*="elementor-element-"],[class*="th-el-"]').forEach((el) => {
    const cn = (el.className || '').toString();
    const id = (cn.match(/elementor-element-([0-9a-f]{6,})/) || cn.match(/(?:^|\\s)th-el-([0-9a-f]{6,})(?:\\s|$)/) || [])[1];
    if (!id || out[id]) return;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out[id] = {
      w: Math.round(r.width), h: Math.round(r.height),
      fs: cs.fontSize, ff: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
      over: el.scrollWidth > el.clientWidth + 2 ? 1 : 0,
      txt: (el.textContent || '').trim().slice(0, 30),
    };
  });
  return JSON.stringify(out);
})()`;

export async function audit() {
  const profile = mkdtempSync(join(tmpdir(), 'ea-'));
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--remote-debugging-port=9491', `--user-data-dir=${profile}`,
     '--no-first-run', '--use-gl=angle', '--use-angle=swiftshader', '--hide-scrollbars', 'about:blank'],
    { stdio: 'ignore' });
  const ws = new WebSocket(await connect(9491));
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const waiting = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Page.enable'); await send('Runtime.enable');

  const grab = async (origin, path, width) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await send('Page.navigate', { url: origin + path });
    await new Promise((r) => setTimeout(r, 3600));
    for (let y = 0; y < 12; y++) { await evaluate(`window.scrollTo(0,${y * 800})`); await new Promise((r) => setTimeout(r, 200)); }
    await evaluate('window.scrollTo(0,0)');
    await new Promise((r) => setTimeout(r, 800));
    return JSON.parse(await evaluate(PROBE));
  };

  const findings = [];
  for (const [ourPath, refPath] of PAGES) {
    for (const width of WIDTHS) {
      const ref = await grab(REFERENCE, refPath, width);
      const ours = await grab(OURS, ourPath, width);
      for (const [eid, a] of Object.entries(ref)) {
        const b = ours[eid];
        if (!b) { findings.push({ page: ourPath, width, id: eid, kind: 'absent', ref: `${a.w}x${a.h}`, ours: '-', why: `"${a.txt}" exists on the reference and not on ours` }); continue; }
        if (a.w > 0 && Math.abs(b.w - a.w) / a.w > TOL) findings.push({ page: ourPath, width, id: eid, kind: 'width', ref: a.w, ours: b.w, why: `"${a.txt || b.txt}"` });
        else if (a.h > 0 && Math.abs(b.h - a.h) / a.h > TOL) findings.push({ page: ourPath, width, id: eid, kind: 'height', ref: a.h, ours: b.h, why: `"${a.txt || b.txt}"` });
        if (!a.over && b.over) findings.push({ page: ourPath, width, id: eid, kind: 'overflows', ref: 'contained', ours: 'text spills', why: `"${b.txt}"` });
        if (a.ff !== b.ff) findings.push({ page: ourPath, width, id: eid, kind: 'font', ref: a.ff, ours: b.ff, why: `"${a.txt || b.txt}"` });
      }
      const done = findings.filter((f) => f.page === ourPath && f.width === width).length;
      console.log(`${ourPath.padEnd(30)} @${String(width).padEnd(5)} elements=${Object.keys(ref).length}  findings=${done}`);
    }
  }
  chrome.kill(); ws.close();
  writeFileSync('/tmp/element-audit.json', JSON.stringify(findings, null, 1));

  console.log(`\n===== ${findings.length} FINDINGS =====`);
  const byKind = {};
  findings.forEach((f) => { (byKind[f.kind] ??= []).push(f); });
  for (const [kind, list] of Object.entries(byKind)) {
    console.log(`\n-- ${kind} (${list.length})`);
    // Group by element so one broken component is one line, not nine.
    const byId = {};
    list.forEach((f) => { (byId[f.page + ' ' + f.id] ??= []).push(f); });
    Object.entries(byId).slice(0, 14).forEach(([k, fs]) => {
      const f = fs[0];
      console.log(`   ${k.padEnd(46)} ref ${String(f.ref).padEnd(10)} ours ${String(f.ours).padEnd(10)} @${fs.map((x) => x.width).join(',')}  ${f.why}`);
    });
  }
  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const f = await audit();
  process.exit(f.length ? 1 : 0);
}
