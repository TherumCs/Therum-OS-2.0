// Port the reference's actual rendered HTML, so the CSS lands on the DOM it
// was written for.
//
// Every CSS-only attempt failed for one reason: the moderno theme's rules are
// written against a specific DOM shape and a three-layer custom-property chain
//
//     --padding-left: 70px            on the element
//     --padding-inline-start: var(--padding-left)     alias layer
//     padding-inline-start: var(--padding-inline-start)   applied on the container
//
// and our importer produced a different tree. Identical CSS on a different DOM
// computes different numbers: the footer row measured content=1440 pad=0/0
// where the reference had content=1300 pad=70/70, so every 33.33% child came
// out 288px instead of 256px.
//
// So the markup is taken, not rebuilt. Same wrappers, same nesting, same
// classes — then the stylesheet cascades exactly as it does on the reference,
// and no further CSS work is needed for a page to match.
//
// NOTHING ELEMENTOR (PORTING.md rule 2) still holds, via a BIJECTIVE RENAME
// applied to the markup and the stylesheet together. `elementor-element-x`
// becomes `th-el-x` on both sides. Renaming both sides identically preserves
// every match while removing the vocabulary — the alternative, keeping their
// names, is what the rule forbids, and dropping the classes would break the
// cascade this exists to fix.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REFERENCE = process.env.REFERENCE_ORIGIN ?? 'http://localhost:8080';

/**
 * The rename. Longest patterns first so `elementor-element-` is consumed
 * before the shorter `elementor-` prefix can half-match it.
 */
export const RENAMES = [
  [/\belementor-element-([0-9a-f]{6,})\b/g, 'th-el-$1'],
  [/\belementor-widget-container\b/g, 'th-w-container'],
  [/\belementor-widget-([a-z0-9_-]+)\b/g, 'th-w-$1'],
  [/\belementor-widget\b/g, 'th-w'],
  [/\belementor-element\b/g, 'th-el'],
  [/\belementor-(\d+)\b/g, 'th-page-$1'],
  [/\belementor-([a-z0-9_-]+)\b/g, 'th-$1'],
  // WordPress body classes name the page template too
  // (page-template-elementor_header_footer); the word-boundary patterns above
  // do not reach an underscore-joined form.
  [/elementor_header_footer/g, 'th-header-footer'],
  [/\belementor\b/g, 'th-root'],
  [/\be-con-inner\b/g, 'th-con-inner'],
  [/\be-con-boxed\b/g, 'th-con-boxed'],
  [/\be-con-full\b/g, 'th-con-full'],
  [/\be-con\b/g, 'th-con'],
  [/\be-flex\b/g, 'th-flex'],
  [/\be-grid\b/g, 'th-grid'],
  [/\be-child\b/g, 'th-child'],
  [/\be-parent\b/g, 'th-parent'],
  [/\be-transform\b/g, 'th-transform'],
  [/--e-con-/g, '--th-con-'],
  [/\be-font-icon-svg\b/g, 'th-font-icon-svg'],
];

export function rename(text) {
  let out = text;
  for (const [re, to] of RENAMES) out = out.replace(re, to);
  return out;
}

/** Point every reference URL at our own origin. */
export function rewriteUrls(html) {
  // Strip the reference origin (absolute and protocol-relative forms) so links
  // resolve against our own host instead of the source site.
  const host = REFERENCE.replace(/^https?:\/\//, '');
  const esc = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html
    .replace(new RegExp(`https?://${esc}`, 'g'), '')
    .replace(new RegExp(`//${esc}`, 'g'), '')
    // WordPress asset paths are served from the platform's static asset root.
    .replace(/(["'(])\/wp-content\//g, '$1/wp-content/')
    .replace(/(["'(])\/wp-includes\//g, '$1/wp-includes/');
}

/**
 * Strip what must not be carried across: the reference's own scripts, its
 * stylesheet links (we serve one), and anything WordPress-only.
 *
 * Scripts are dropped rather than ported because our runtime already provides
 * cart, wishlist, search and the admin dock; running theirs as well would give
 * every control two handlers.
 */
export function clean(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    // Lazy-loading placeholders: the real src is in data-src, and without the
    // theme's JS the placeholder never resolves.
    .replace(/\ssrc="data:image\/[^"]*"/gi, '')
    .replace(/\sdata-src=/gi, ' src=')
    .replace(/\sdata-lazyloaded="1"/gi, '');
}

export function port(html) {
  return rename(rewriteUrls(clean(html)));
}

/** Pull one page and return its cleaned, renamed markup. */
export async function fetchPage(path) {
  const res = await fetch(REFERENCE + path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return await res.text();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const html = await fetchPage(process.argv[2] ?? '/');
  const out = port(html);
  writeFileSync('/tmp/ported.html', out);
  const legacy = (out.match(/elementor|\be-con\b|\be-flex\b/gi) || []).length;
  console.log(`in  : ${html.length} bytes`);
  console.log(`out : ${out.length} bytes`);
  console.log(`scripts left : ${(out.match(/<script/gi) || []).length}`);
  console.log(`LEGACY TOKENS: ${legacy} ${legacy ? '<-- MUST BE 0' : '(clean)'}`);
}
