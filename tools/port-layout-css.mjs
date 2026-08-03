// Port the reference's PER-ELEMENT layout rules onto our Bricks classes.
//
// The theme files give components (c-header__*, c-ip-*). The page LAYOUT —
// which element is 306px, which is a flex column, which collapses at 767 — is
// in the reference's per-element rules. Strip those and every element renders
// full width, which is exactly what happened: 2127 width findings, ours 1440
// against a reference 306.
//
// So they are PORTED, not dropped and not re-derived. Only the SELECTOR
// vocabulary changes:
//
//   .elementor-165012 .elementor-element.elementor-element-a7707ab {...}
//                            becomes
//   .el-a7707ab {...}
//
// The DECLARATIONS are copied verbatim, which is the whole point: they are the
// theme author's own values and they are relative — 457 percentages, 207
// calc(), 153 var(), 20 vh, 9 vw across the file. An earlier attempt read
// COMPUTED styles instead and wrote absolute pixels, which threw all of that
// away and broke every width away from the captured viewport. Copying the
// authored rule keeps the responsiveness because the responsiveness IS the
// declaration.
//
// Media queries come along unchanged, so the reference's own breakpoints are
// the site's breakpoints.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chunks, LEGACY } from './frontend-css.mjs';

const SRC = process.env.REF_CSS_ALL ?? '/tmp/allref.css';
const OUT = process.env.LAYOUT_CSS_OUT ?? '/tmp/layout.css';

// Our markup's container elements. Elementor's `.e-con` carries the contract
// that turns its custom properties into real declarations
// (`min-height: var(--min-height)` and friends); without it every --min-height
// on an element is set and read by nothing.
const CONTAINER = ':is(.brxe-container,.brxe-block,.brxe-section,.brxe-div)';

const ELEMENT_ID = /\.elementor-element\.elementor-element-([0-9a-f]{6,})|\.elementor-element-([0-9a-f]{6,})/g;

/**
 * Rewrite one selector, or return null if it cannot be expressed in our markup.
 *
 * Null rather than a guess: `.e-con-inner` names an element our renderer does
 * not produce, and inventing a stand-in for it would be exactly the fabrication
 * PORTING.md rule 1 forbids.
 */
export function portSelector(sel) {
  if (/e-con-inner|elementor-widget-container|elementor-motion-effects/.test(sel)) return null;

  let out = sel
    // Page scope prefix: our pages carry no scope wrapper, and the element id
    // is unique on its own.
    .replace(/\.elementor-\d+\s+/g, '')
    // The element id, in either of the forms the reference writes it.
    .replace(ELEMENT_ID, (_m, a, b) => `.el-${a || b}`)
    // Structural classes -> the Bricks elements that stand in for them.
    .replace(/\.e-con\.e-flex/g, CONTAINER)
    .replace(/\.e-con-full|\.e-con-boxed/g, CONTAINER)
    .replace(/\.e-con\b/g, CONTAINER)
    .replace(/\.e-flex\b/g, CONTAINER)
    .replace(/\.e-child\b|\.e-parent\b|\.e-grid\b/g, '')
    // Widget wrappers we no longer emit: the element itself is the widget.
    .replace(/\.elementor-widget\.elementor-widget-[a-z0-9_-]+/g, '')
    .replace(/\.elementor-widget-[a-z0-9_-]+/g, '')
    .replace(/\.elementor-widget\b/g, '');

  out = out.replace(/\s{2,}/g, ' ').replace(/\s*,\s*/g, ',').trim();
  // Anything still naming the old builder could not be ported honestly.
  if (!out || LEGACY.test(out)) return null;
  // A selector that reduced to nothing meaningful would apply site-wide.
  if (/^[\s,>+~]*$/.test(out)) return null;
  return out;
}

function portChunk(chunk) {
  const open = chunk.indexOf('{');
  if (open < 0) return null;
  const head = chunk.slice(0, open).trim();

  if (/^@(media|supports|container)/i.test(head)) {
    const inner = chunk.slice(open + 1, chunk.lastIndexOf('}'));
    const kept = chunks(inner).map(portChunk).filter(Boolean);
    return kept.length ? `${head}{${kept.join('')}}` : null;
  }
  if (/^@/.test(head)) return null; // @font-face etc. already came with the theme

  // Only rules that actually target an element or the container contract.
  if (!/elementor-element-|\.e-con|\.e-flex/.test(head)) return null;

  const sels = head.split(',').map(portSelector).filter(Boolean);
  if (!sels.length) return null;
  return `${[...new Set(sels)].join(',')}${chunk.slice(open)}`;
}

export function build() {
  const seen = new Set();
  const out = [];
  let considered = 0;
  for (const chunk of chunks(readFileSync(SRC, 'utf8'))) {
    considered++;
    const ported = portChunk(chunk);
    if (!ported || seen.has(ported)) continue;
    seen.add(ported); out.push(ported);
  }
  const css = [
    '/* Page layout, ported from localhost:10025.',
    '   Selectors rewritten onto our Bricks classes; declarations copied',
    '   verbatim so the relative units the theme is built on survive.',
    '   See PORTING.md and tools/port-layout-css.mjs. */',
    ...out,
  ].join('\n');
  const bad = chunks(css).filter((c) => LEGACY.test(c.slice(0, c.indexOf('{'))));
  writeFileSync(OUT, css);
  console.log(`chunks considered : ${considered}`);
  console.log(`layout rules ported: ${out.length}`);
  console.log(`.el- selectors     : ${(css.match(/\.el-[0-9a-f]{6,}/g) || []).length}`);
  console.log(`@media kept        : ${(css.match(/@media/g) || []).length}`);
  console.log(`relative units     : ${(css.match(/%|calc\(|vw|vh/g) || []).length}`);
  console.log(`bytes              : ${css.length}`);
  console.log(`LEGACY SELECTORS   : ${bad.length} ${bad.length ? '<-- MUST BE 0' : '(clean)'}`);
  return bad.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(build() ? 1 : 0);
}
