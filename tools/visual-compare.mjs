// Compare our live frontend against the reference site, page by page,
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
import { pathToFileURL } from 'node:url';

const REFERENCE = process.env.REFERENCE_ORIGIN ?? 'http://localhost:8080';
const OURS = process.env.SITE_ORIGIN ?? process.env.PUBLIC_ORIGIN ?? '';
const OUT = process.env.COMPARE_OUT ?? '/tmp/visual-compare';

// our path -> reference path. Only pages that exist on both sides; a page with
// no counterpart is not comparable and saying so beats inventing a match. Edit
// these mappings for the site being compared.
export const PAGE_MAP = [
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

const WIDTHS = (process.env.COMPARE_WIDTHS ?? '1440,768,390').split(',').map(Number);

// Tolerance is per-breakpoint because content that reflows legitimately
// differs by a few px; anything past this is a real layout difference.
const HEIGHT_TOLERANCE = 0.06;      // per section, vs the reference section height
const PAGE_HEIGHT_TOLERANCE = 0.10; // whole page, vs the reference page height
const PIXEL_TOLERANCE = 12;         // % of pixels allowed to differ from the reference

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
  const failures = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
      failures.push(`${m.params.response.status} ${m.params.response.url.split('/').pop().slice(0, 40)}`);
    }
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
      .result?.result?.value;
  return { send, evaluate, failures };
}

// The measurement. Sections are the top-level children of whatever holds the
// page body, so the same shape is read on both sides even though the wrappers
// are named differently.
const MEASURE = `(() => {
  // The reference wraps its FOOTER in .elementor-505 as well as wrapping page
  // content in .elementor-<page id>. Taking the first .elementor match meant
  // that on any page without its own Elementor design we compared our page
  // body against their footer — which is why one footer element reported the
  // same bogus delta across eight unrelated pages. Skip any wrapper that sits
  // inside a header or footer.
  const inChrome = (el) => !!el.closest('header, footer, #brx-header, #brx-footer');
  const root = [...document.querySelectorAll('.elementor')].find((el) => !inChrome(el))
    || document.querySelector('#brx-content')
    || document.querySelector('main')
    || document.body;
  const sections = [...root.children]
    .map((el, i) => {
      const r = el.getBoundingClientRect();
      // Elementor's own element id is the only stable identity across the two
      // sites — class names and wrappers differ, the id does not.
      // Reference uses the old builder's class, ours uses Bricks el-<id>.
      const cn = (el.className || '').toString();
      const id = (cn.match(/elementor-element-([0-9a-f]{6,})/) || cn.match(/(?:^|\\s)th-el-([0-9a-f]{6,})(?:\\s|$)/) || [])[1] || null;
      return { id, i, h: Math.round(r.height), w: Math.round(r.width) };
    })
    .filter((s) => s.h > 4); // ignore screen-reader and zero-height nodes
  const de = document.documentElement;
  return JSON.stringify({
    height: de.scrollHeight,
    scrollWidth: de.scrollWidth,
    sections,
    collapsed: [...document.querySelectorAll('.e-con, .th-con, .brxe-container, .brxe-block')]
      .filter((e) => e.getBoundingClientRect().height < 2).length,
  });
})()`;

// Geometry alone is blind to a whole class of breakage. A missing webfont or
// background image does not change layout height — the icon becomes an empty
// box, the hero goes blank, and every section still measures exactly right. The
// imported stylesheet shipped without the 15 files it references and every
// geometric check still passed while the live page had boxes for icons and no
// hero. So the asset layer is checked explicitly, and a pixel diff backs it up.
const ASSET_HEALTH = `(() => ({
  brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).length,
  totalImages: document.images.length,
  fontsUnloaded: [...document.fonts].filter((f) => f.status === 'error').map((f) => f.family),
}))()`;

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
  const geometry = JSON.parse(await page.evaluate(MEASURE));
  return { ...geometry, ...(await page.evaluate(ASSET_HEALTH)) };
}

// Percentage of pixels that differ between two screenshots, computed in the
// browser so this needs no image library. Compared at a coarse scale: the
// question is "does this look like the reference", not "is it byte-identical",
// and antialiasing differences must not drown the signal.
async function pixelDiff(page, aPng, bPng) {
  const script = `(async () => {
    const load = (b64) => new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im); im.onerror = rej;
      im.src = 'data:image/png;base64,' + b64;
    });
    const [a, b] = await Promise.all([load(${JSON.stringify(aPng)}), load(${JSON.stringify(bPng)})]);
    const W = 240, H = Math.min(1200, Math.max(a.height, b.height) / Math.max(a.width, b.width) * W | 0);
    const draw = (im) => {
      const c = new OffscreenCanvas(W, H);
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
      x.drawImage(im, 0, 0, W, im.height * (W / im.width));
      return x.getImageData(0, 0, W, H).data;
    };
    const da = draw(a), db = draw(b);
    let diff = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i] - db[i]) + Math.abs(da[i+1] - db[i+1]) + Math.abs(da[i+2] - db[i+2]) > 90) diff++;
    }
    return Math.round((diff / (da.length / 4)) * 100);
  })()`;
  try { return await page.evaluate(script); } catch { return null; }
}

async function shoot(page, width, height, file) {
  // Viewport stays put — see the note at the top of this file.
  const shot = await page.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height: Math.min(height, 16000), scale: 1 },
  });
  if (!shot.result) return null;
  writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
  return shot.result.data;
}

export async function run(pages = PAGE_MAP, widths = WIDTHS) {
  mkdirSync(OUT, { recursive: true });
  const proc = cdp(9450);
  const ws = new WebSocket(await connect(9450));
  await new Promise((r) => { ws.onopen = r; });
  const page = client(ws);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  // A 404 on a font or image never shows up in geometry, so watch the wire.
  await page.send('Network.enable');

  const results = [];
  for (const [ourPath, refPath] of pages) {
    for (const width of widths) {
      const ref = await measure(page, REFERENCE, refPath, width);
      const refFile = join(OUT, `${ourPath.replace(/\W+/g, '_')}-${width}-ref.png`);
      const refPng = await shoot(page, width, ref.height, refFile);

      // Only OUR request failures count — the reference's own 404s are not ours
      // to fix, so the sink is cleared before loading our page.
      page.failures.length = 0;
      const ours = await measure(page, OURS, ourPath, width);
      const ourFile = join(OUT, `${ourPath.replace(/\W+/g, '_')}-${width}-ours.png`);
      const ourPng = await shoot(page, width, ours.height, ourFile);
      const failedRequests = [...page.failures];
      const pixels = refPng && ourPng ? await pixelDiff(page, refPng, ourPng) : null;

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
      }
      // When NEITHER side has Elementor ids the page has no Elementor design at
      // all (policy pages, shop, blog — theme/Woo templates). The two roots are
      // then different containers holding different numbers of wrappers, so
      // comparing child N to child N is meaningless: it reported shop's first
      // section as "2407% off" purely from wrapper mismatch. Page height and
      // overflow still mean something on those pages, so judge on those alone.
      const problems = [];
      if (overflow > 1) problems.push(`overflows viewport by ${overflow}px`);
      // Total height has to be a pass criterion in its own right. Without it a
      // page whose sections happen to match can still be missing most of its
      // content and report clean — the blog read "pass" at 1133px against a
      // 3141px reference.
      if (heightDelta > PAGE_HEIGHT_TOLERANCE)
        problems.push(`page height ${ours.height} vs ${ref.height} (${Math.round(heightDelta * 100)}% off)`);
      if (missing.length) problems.push(`${missing.length} reference section(s) absent: ${missing.join(',')}`);
      if (badSections.length) problems.push(`${badSections.length} section(s) off height`);
      if (ours.collapsed > ref.collapsed)
        problems.push(`${ours.collapsed - ref.collapsed} extra collapsed container(s)`);
      // The asset layer. These are pass criteria in their own right — a page can
      // be geometrically perfect and still be boxes and blank rectangles.
      if (ours.brokenImages > 0)
        problems.push(`${ours.brokenImages}/${ours.totalImages} images failed to load`);
      if (ours.fontsUnloaded?.length)
        problems.push(`webfont(s) failed: ${ours.fontsUnloaded.join(',')}`);
      if (failedRequests.length)
        problems.push(`${failedRequests.length} request(s) 4xx/5xx: ${[...new Set(failedRequests)].slice(0, 3).join(' ')}`);
      if (pixels !== null && pixels > PIXEL_TOLERANCE)
        problems.push(`${pixels}% of pixels differ from the reference`);

      results.push({
        page: ourPath, width, pass: problems.length === 0, problems, badSections, missing,
        pixelDiff: pixels, brokenImages: ours.brokenImages, failedRequests,
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

// pathToFileURL, not string concatenation: this repo lives under "Local Sites",
// and a raw `file://${path}` leaves the space unencoded so the comparison never
// matches — the script exits 0 having run nothing, which reads exactly like a
// clean pass.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await run();
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}
