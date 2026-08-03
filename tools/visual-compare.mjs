// Compare our live frontend against the :10025 reference, page by page,
// breakpoint by breakpoint, and report a verdict a script can act on.
//
// Why this exists: nothing in this repo checked layout, so "done" rested on
// somebody looking at a screenshot. That is latent-space work with a
// deterministic answer available — Forge: write the script, then the script
// constrains the model forever after.
//
// Two traps this encodes, both of which produced confidently wrong results
// before:
//   1. NEVER resize the viewport to the page height to capture full-page.
//      Sections built on 100vh re-render at that height and the screenshot
//      matches nothing on screen. Keep the viewport fixed and pass
//      captureBeyondViewport.
//   2. Compare RENDERED GEOMETRY, not stylesheet contents. A rule that is
//      present proves nothing; only what the browser computed counts.
//
// Usage: node tools/visual-compare.mjs [--pages a,b] [--widths 1440,768,390]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REFERENCE = process.env.REFERENCE_ORIGIN ?? 'http://localhost:10025';
const OURS = process.env.SITE_ORIGIN ?? 'https://sidemoney.co';
const OUT = process.env.COMPARE_OUT ?? '/tmp/visual-compare';

// our path -> reference path. Only pages that exist on both sides; a page with
// no counterpart is not comparable and saying so beats inventing a match.
export const PAGE_MAP = [
  ['/', '/'],
  ['/about-the-sidemoney-company', '/about-sidemoney/'],
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

const WIDTHS = (process.env.COMPARE_WIDTHS ?? '1440,768,390').split(',').map(Number);

// Tolerance is per-breakpoint because content that reflows legitimately
// differs by a few px; anything past this is a real layout difference.
const HEIGHT_TOLERANCE = 0.06; // 6% of the reference section height

function cdp(port) {
  const profile = mkdtempSync(join(tmpdir(), 'vc-'));
  const proc = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
     '--no-first-run', '--use-gl=angle', '--use-angle=swiftshader', '--hide-scrollbars', 'about:blank'],
    { stdio: 'ignore' },
  );
  return proc;
}

async function connect(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* chrome not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('chrome never came up');
}

function client(ws) {
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
      .result?.result?.value;
  return { send, evaluate };
}

// The measurement. Sections are the top-level children of whatever holds the
// page body, so the same shape is read on both sides even though the wrappers
// are named differently.
const MEASURE = `(() => {
  const root = document.querySelector('.elementor')
    || document.querySelector('#brx-content')
    || document.querySelector('main')
    || document.body;
  const sections = [...root.children]
    .map((el, i) => {
      const r = el.getBoundingClientRect();
      // Elementor's own element id is the only stable identity across the two
      // sites — class names and wrappers differ, the id does not.
      const id = ((el.className || '').toString().match(/elementor-element-([0-9a-f]+)/) || [])[1] || null;
      return { id, i, h: Math.round(r.height), w: Math.round(r.width) };
    })
    .filter((s) => s.h > 4); // ignore screen-reader and zero-height nodes
  const de = document.documentElement;
  return JSON.stringify({
    height: de.scrollHeight,
    scrollWidth: de.scrollWidth,
    sections,
    collapsed: [...document.querySelectorAll('.e-con, .brxe-container')]
      .filter((e) => e.getBoundingClientRect().height < 2).length,
  });
})()`;

async function measure(page, origin, path, width) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width, height: 900, deviceScaleFactor: 1, mobile: width < 768,
  });
  await page.send('Page.navigate', { url: origin + path });
  await new Promise((r) => setTimeout(r, 3600));
  // Walk the page so lazy images load, then return to the top.
  for (let y = 0; y < 14; y++) {
    await page.evaluate(`window.scrollTo(0, ${y * 800})`);
    await new Promise((r) => setTimeout(r, 220));
  }
  await page.evaluate('window.scrollTo(0,0)');
  await new Promise((r) => setTimeout(r, 900));
  return JSON.parse(await page.evaluate(MEASURE));
}

async function shoot(page, width, height, file) {
  // Viewport stays put — see the note at the top of this file.
  const shot = await page.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height: Math.min(height, 16000), scale: 1 },
  });
  if (shot.result) writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
}

export async function run(pages = PAGE_MAP, widths = WIDTHS) {
  mkdirSync(OUT, { recursive: true });
  const proc = cdp(9450);
  const ws = new WebSocket(await connect(9450));
  await new Promise((r) => { ws.onopen = r; });
  const page = client(ws);
  await page.send('Page.enable');
  await page.send('Runtime.enable');

  const results = [];
  for (const [ourPath, refPath] of pages) {
    for (const width of widths) {
      const ref = await measure(page, REFERENCE, refPath, width);
      const refFile = join(OUT, `${ourPath.replace(/\W+/g, '_')}-${width}-ref.png`);
      await shoot(page, width, ref.height, refFile);

      const ours = await measure(page, OURS, ourPath, width);
      const ourFile = join(OUT, `${ourPath.replace(/\W+/g, '_')}-${width}-ours.png`);
      await shoot(page, width, ours.height, ourFile);

      const overflow = ours.scrollWidth - width;
      const heightDelta = ref.height ? Math.abs(ours.height - ref.height) / ref.height : 1;
      // Match by Elementor id where both sides have one, else fall back to
      // position. Matching by position alone turns a single ordering
      // difference into a cascade of bogus "wrong height" reports, which is
      // noise dressed up as findings.
      const byId = ref.sections.every((s) => s.id) && ours.sections.some((s) => s.id);
      const badSections = [];
      const missing = [];
      if (byId) {
        const oursById = new Map(ours.sections.filter((s) => s.id).map((s) => [s.id, s]));
        for (const a of ref.sections) {
          const b = oursById.get(a.id);
          if (!b) { missing.push(a.id); continue; }
          const d = Math.abs(b.h - a.h) / a.h;
          if (d > HEIGHT_TOLERANCE) badSections.push({ i: a.id, ref: a.h, ours: b.h, off: `${Math.round(d * 100)}%` });
        }
      } else {
        const pairs = Math.min(ref.sections.length, ours.sections.length);
        for (let i = 0; i < pairs; i++) {
          const a = ref.sections[i], b = ours.sections[i];
          if (!a.h) continue;
          const d = Math.abs(b.h - a.h) / a.h;
          if (d > HEIGHT_TOLERANCE) badSections.push({ i, ref: a.h, ours: b.h, off: `${Math.round(d * 100)}%` });
        }
      }
      const problems = [];
      if (overflow > 1) problems.push(`overflows viewport by ${overflow}px`);
      if (missing.length) problems.push(`${missing.length} reference section(s) absent: ${missing.join(',')}`);
      if (badSections.length) problems.push(`${badSections.length} section(s) off height`);
      if (ours.collapsed > ref.collapsed)
        problems.push(`${ours.collapsed - ref.collapsed} extra collapsed container(s)`);

      results.push({
        page: ourPath, width, pass: problems.length === 0, problems, badSections, missing,
        refHeight: ref.height, ourHeight: ours.height, heightDelta: `${Math.round(heightDelta * 100)}%`,
        refShot: refFile, ourShot: ourFile,
      });
      const verdict = problems.length ? 'FAIL' : 'pass';
      console.log(
        `${verdict.padEnd(5)} ${ourPath.padEnd(32)} @${String(width).padEnd(5)} ` +
        `h ${ours.height}/${ref.height} (${Math.round(heightDelta * 100)}%)` +
        (problems.length ? `  :: ${problems.join('; ')}` : ''),
      );
      if (badSections.length) {
        badSections.slice(0, 4).forEach((b) =>
          console.log(`        section ${b.i}: ours ${b.ours} vs ref ${b.ref}  (${b.off} off)`));
      }
    }
  }
  proc.kill(); ws.close();
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed. Report: ${join(OUT, 'results.json')}`);
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = await run();
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}
