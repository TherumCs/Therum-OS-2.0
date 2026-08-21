// Build the whole port: the reference's markup and the reference's stylesheet,
// renamed together, so the CSS lands on the DOM it was written for.
//
// See tools/port-markup.mjs for why the markup is taken rather than rebuilt,
// and why the rename is applied to BOTH sides.
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { rename, rewriteUrls, port, fetchPage } from './port-markup.mjs';

const REFERENCE = process.env.REFERENCE_ORIGIN ?? 'http://localhost:8080';

// our slug -> reference path. Example mappings for a WordPress source; set these
// to the source site's own pages. Chrome regions are pulled from the home page,
// which carries the same header and footer as every other.
export const PAGES = [
  ['home', '/'],
  ['about', '/about/'],
  ['faq', '/faq/'],
  ['contact', '/contact/'],
  ['terms-and-conditions', '/terms-and-conditions/'],
  ['privacy-statement', '/privacy-statement/'],
  ['cookie-policy', '/cookie-policy/'],
  ['accessibility-statement', '/accessibility-statement/'],
  ['refund_returns', '/refund_returns/'],
  ['order-tracking', '/order-tracking/'],
];

/**
 * Cut one region out of a page by matching its opening tag and walking tags
 * until the depth returns to zero.
 *
 * A regex cannot do this — these regions nest dozens of divs deep and any
 * lazy or greedy match cuts in the wrong place, which is how a footer ends up
 * half-closed and swallows the rest of the document.
 */
export function extractRegion(html, openRe) {
  const m = openRe.exec(html);
  if (!m) return null;
  const start = m.index;
  const tagName = /^<\s*([a-z0-9]+)/i.exec(m[0])?.[1];
  if (!tagName) return null;
  const tagRe = new RegExp(`<\\s*(/?)${tagName}\\b`, 'gi');
  tagRe.lastIndex = start;
  let depth = 0, hit;
  while ((hit = tagRe.exec(html))) {
    depth += hit[1] ? -1 : 1;
    if (depth === 0) {
      const close = html.indexOf('>', hit.index);
      return html.slice(start, close + 1);
    }
  }
  return null;
}

export async function build() {
  mkdirSync('/tmp/port', { recursive: true });
  const homeRaw = await fetchPage('/');
  const home = port(homeRaw);

  // The chrome. Taken once, used on every page — this is what "header and
  // footer locked in" means: one region, ported once, reused everywhere.
  const header = extractRegion(home, /<header\b[^>]*class="[^"]*l-section[^"]*"[^>]*>/i)
    || extractRegion(home, /<header\b[^>]*>/i);
  const footer = extractRegion(home, /<footer\b[^>]*class="[^"]*l-section[^"]*"[^>]*>/i)
    || extractRegion(home, /<footer\b[^>]*>/i);
  if (!header || !footer) throw new Error(`chrome not found (header:${!!header} footer:${!!footer})`);
  writeFileSync('/tmp/port/header.html', header);
  writeFileSync('/tmp/port/footer.html', footer);
  console.log(`header : ${header.length} bytes`);
  console.log(`footer : ${footer.length} bytes`);

  // Page bodies: the content wrapper, which is the region the page's own
  // rules are scoped to.
  const bodies = {};
  for (const [slug, path] of PAGES) {
    let raw;
    try { raw = await fetchPage(path); } catch (e) { console.log(`  ${slug.padEnd(30)} SKIP ${e.message}`); continue; }
    const html = port(raw);
    // Cut the chrome out FIRST. The footer carries its own th-root wrapper,
    // so searching the whole document returns the footer on any page without a
    // page-scoped wrapper of its own — which is why every policy page came out
    // as the same 9058 bytes.
    const hdr = extractRegion(html, /<header\b[^>]*>/i);
    const ftr = extractRegion(html, /<footer\b[^>]*>/i);
    let inner = html;
    if (hdr) inner = inner.replace(hdr, '');
    if (ftr) inner = inner.replace(ftr, '');
    // Take the whole CONTENT REGION, not just the innermost wrapper.
    //
    // The theme wraps a page in its own chrome — on FAQ that is
    // c-post__container > l-section__content > article.c-post > c-post__inner,
    // and THAT is what narrows 1440 down to 688. Extracting only the inner
    // wrapper threw the narrowing away and every FAQ column rendered full
    // width. l-inner is the region between header and footer, so it carries
    // whatever chrome a given page template uses.
    const body = extractRegion(inner, /<main\b[^>]*class="[^"]*\bl-inner\b[^"]*"[^>]*>/i)
      || extractRegion(inner, /<div\b[^>]*class="[^"]*\bl-inner\b[^"]*"[^>]*>/i)
      || extractRegion(inner, /<main\b[^>]*>/i)
      || extractRegion(inner, /<div\b[^>]*class="[^"]*\bth-root\b[^"]*"[^>]*>/i);
    if (!body) { console.log(`  ${slug.padEnd(30)} NO BODY REGION`); continue; }
    bodies[slug] = body;
    const legacy = (body.match(/elementor|\be-con\b|\be-flex\b/gi) || []).length;
    console.log(`  ${slug.padEnd(30)} ${String(body.length).padStart(7)} bytes  legacy=${legacy}`);
  }
  writeFileSync('/tmp/port/bodies.json', JSON.stringify(bodies));

  // The stylesheet, renamed the same way. Same transform on both sides is what
  // keeps every selector matching.
  // The reference's stylesheets, whole, with the vocabulary renamed rather
  // than removed. Dropping those rules is what left the pages unstyled: they
  // ARE the per-element layout. Renaming both sides keeps every selector
  // matching while satisfying rule 2.
  const { readFileSync } = await import('node:fs');
  const { chunks, malformed } = await import('./frontend-css.mjs');
  const raw = readFileSync('/tmp/allref.css', 'utf8');
  const seen = new Set();
  const kept = [];
  for (const chunk of chunks(raw)) {
    const sel = chunk.slice(0, chunk.indexOf('{'));
    // A malformed selector stops the browser parsing the rest of the file.
    if (malformed(sel)) continue;
    // URLs as well as class names: the stylesheet's background-image rules
    // point at the reference's origin, and without this every hero rendered
    // blank while the <img> checks all passed — a background is not an image
    // element, so nothing flagged it.
    const r = rewriteUrls(rename(chunk));
    if (seen.has(r)) continue;
    seen.add(r); kept.push(r);
  }
  const css = kept.join('\n');
  writeFileSync('/tmp/port/site.css', css);
  const cssLegacy = (css.match(/elementor|\be-con\b|\be-flex\b/gi) || []).length;
  console.log(`\nstylesheet : ${css.length} bytes  legacy=${cssLegacy}`);
  console.log(`th- classes in css : ${(css.match(/\.th-/g) || []).length}`);
  return { header, footer, bodies, css };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await build();
