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
  // Emptying a part of a grouped selector leaves wreckage behind:
  // `.e-con-full, .elementor-widget)` became `:where()){...}` — an empty
  // :where() and a stray paren. ONE malformed selector stops the browser
  // parsing the rest of the stylesheet, and every per-element rule after it
  // was silently discarded: 3012 rules parsed out of 3530, and not one .el-
  // rule survived. So a ported selector is validated before it is emitted.
  if (/:(?:where|is|not|has)\(\s*\)/.test(out)) return null;   // emptied pseudo
  let bal = 0;
  for (const ch of out) {
    if (ch === '(') bal++;
    else if (ch === ')') { bal--; if (bal < 0) return null; }    // stray close
  }
  if (bal !== 0) return null;                                     // unbalanced
  if (/^[,>+~]|[,>+~]$|,,/.test(out)) return null;                // dangling combinator
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
  // A rule that names NO element id is one of the builder's BASE rules — its
  // job is to supply defaults (--flex-direction:column, display:block) that a
  // per-element rule then overrides. Ported literally, `.e-con` becomes
  // `:is(.brxe-container,...)` at specificity 0,1,0 and `.e-con.e-flex`
  // becomes 0,2,0 — both of which OUTRANK the per-element `.el-<id>` rule at
  // 0,1,0. The defaults then win and every element inherits column/block: the
  // footer row computed --flex-direction:column while its own rule said row.
  //
  // Base rules are therefore emitted at ZERO specificity, which is what a
  // default should have. Per-element rules keep theirs.
  const isBase = !/elementor-element-/.test(head);
  const finalSels = [...new Set(sels)].map((x) => (isBase ? `:where(${x})` : x));
  return `${finalSels.join(',')}${chunk.slice(open)}`;
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
  // Elementor's contract is `display: var(--display)`, and --display is set
  // only on elements the reference styled. On every OTHER container the var
  // resolves to nothing, which computes as `unset` — and an unset div is
  // INLINE, so the element collapses to 0px. That is exactly what happened:
  // el-479c7f3 rendered 0px wide, display inline, against a reference 78px.
  //
  // The defaults go FIRST and at zero specificity, so a ported rule that sets
  // the var always wins and a container without one behaves like the block it
  // was before the contract existed.
  // The var-to-property CONTRACT, read out of the reference. Elementor sets
  // only custom properties per element (--display, --flex-direction,
  // --min-height...) and a separate base rule turns them into real
  // declarations. Only `display: var(--display)` survived the first port, so
  // every OTHER ported property was set and read by nothing — the footer
  // columns stacked at 1360px against a reference 256px because
  // `flex-direction: var(--flex-direction)` was missing.
  //
  // width/height/flex are deliberately NOT in the contract. Applying them
  // collapsed every flex child to 0px and took overflows from 9 to 1074:
  // sizing in our markup comes from the element's own ported rule and from
  // flex behaviour, not from these vars.
  //
  // 73 declarations were found in the reference; these are the layout ones.
  // Component-specific properties (accordion, icon-list) stay with the
  // components that own them, which the theme files already carry.
  const CONTRACT = ':is(.brxe-container,.brxe-block,.brxe-section,.brxe-div){align-content:var(--align-content);align-items:var(--align-items);border-block-end-width:var(--border-block-end-width);border-block-start-width:var(--border-block-start-width);border-color:var(--border-color);border-inline-end-width:var(--border-inline-end-width);border-inline-start-width:var(--border-inline-start-width);border-radius:var(--border-radius);border-style:var(--border-style);display:var(--display);flex-direction:var(--flex-direction);flex-wrap:var(--flex-wrap);gap:var(--row-gap);justify-content:var(--justify-content);margin-block-start:var(--margin-block-start);margin-inline-end:var(--margin-inline-end);margin-inline-start:var(--margin-inline-start);min-height:var(--min-height);overflow:var(--overflow);padding-block-end:var(--padding-block-end);padding-block-start:var(--padding-block-start);padding-inline-end:var(--padding-inline-end);padding-inline-start:var(--padding-inline-start);position:var(--position);text-align:var(--text-align);z-index:var(--z-index)}';

  const DEFAULTS = [
    ':where(.brxe-container,.brxe-block,.brxe-section,.brxe-div){' +
      '--display:block;--flex-direction:column;--justify-content:flex-start;' +
      '--align-items:stretch;--flex-wrap:nowrap;--gap:0px;--row-gap:0px;' +
      '--column-gap:0px;--min-height:auto;--width:auto;--height:auto;' +
      '--padding-top:0px;--padding-right:0px;--padding-bottom:0px;' +
      '--padding-left:0px;--margin-top:0px;--margin-right:0px;' +
      '--margin-bottom:0px;--margin-left:0px;--overflow:visible;' +
      '--position:relative;--z-index:auto;--text-align:initial;' +
      '--border-radius:0;--align-content:normal}',
  ];

  const css = [
    '/* Page layout, ported from localhost:10025.',
    '   Selectors rewritten onto our Bricks classes; declarations copied',
    '   verbatim so the relative units the theme is built on survive.',
    '   See PORTING.md and tools/port-layout-css.mjs. */',
    ...DEFAULTS,
    CONTRACT,
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
