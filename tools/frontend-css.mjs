// The site's frontend stylesheet, taken from the reference at :10025.
//
// PORTING.md: :10025 is a FINISHED site with a fully styled theme — settings
// and CSS included. This TAKES that CSS. It does not derive it, generate it,
// or approximate it. An earlier attempt read computed styles and wrote them
// out as fixed pixels; that threw away every % and flex rule the theme is
// built on and broke tablet and mobile. The theme's own files are already
// responsive — 280-ish media queries in each — so the correct move is to serve
// them, minus the parts our platform does not use.
//
// What is removed: every rule whose selector names the old builder. PORTING.md
// rule 2 is NOTHING ELEMENTOR, and it is enforced here rather than trusted:
// the script exits non-zero if one survives.
//
// What is kept: the theme's own classes (c-*, l-*, h-*, ideapark-*), which our
// ported markup already carries, and the design-system inline styles.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = process.env.REF_CSS_DIR ?? '/tmp/refcss';
const OUT = process.env.FRONTEND_CSS_OUT ?? '/tmp/frontend.css';

/** Selector tokens belonging to the old builder. */
export const LEGACY = /elementor|\be-con\b|\be-con-inner\b|\be-con-boxed\b|\be-flex\b|\be-grid\b|\be-child\b|\be-parent\b|\be-transform\b/i;

/**
 * Split a stylesheet into top-level chunks, brace-matched.
 *
 * A regex cannot do this: @media blocks nest, and a naive split on `}` cuts
 * them in half and corrupts every responsive rule in the file — which is the
 * whole reason for taking these files in the first place.
 */
export function chunks(css) {
  const out = [];
  let depth = 0, start = 0, inStr = null, inComment = false;
  for (let i = 0; i < css.length; i++) {
    const c = css[i], n = css[i + 1];
    if (inComment) { if (c === '*' && n === '/') { inComment = false; i++; } continue; }
    if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '/' && n === '*') { inComment = true; i++; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { out.push(css.slice(start, i + 1).trim()); start = i + 1; }
    }
  }
  const tail = css.slice(start).trim();
  if (tail) out.push(tail);
  return out.filter(Boolean);
}

/** A chunk's selector — everything before its first brace. */
const selectorOf = (chunk) => chunk.slice(0, chunk.indexOf('{'));

/**
 * Would this selector stop the browser parsing?
 *
 * ONE malformed selector discards every rule after it in the stylesheet — a
 * stray `)` left by dropping part of a grouped selector cost 518 rules,
 * including every per-element rule, and the page looked simply unstyled with
 * no error anywhere. Cheap to check, silent and total when missed.
 */
export function malformed(sel) {
  if (/:(?:where|is|not|has)\(\s*\)/.test(sel)) return true;
  let bal = 0;
  for (const ch of sel) {
    if (ch === '(') bal++;
    else if (ch === ')') { bal--; if (bal < 0) return true; }
  }
  return bal !== 0;
}

/**
 * Inside an @media block, drop only the legacy rules and keep the rest. An
 * @media that mixes theme rules with builder rules is common, and dropping the
 * whole block would take real responsive rules with it.
 */
function filterMedia(chunk) {
  const open = chunk.indexOf('{');
  const head = chunk.slice(0, open + 1);
  const inner = chunk.slice(open + 1, chunk.lastIndexOf('}'));
  const kept = chunks(inner).filter((r) => !LEGACY.test(selectorOf(r)) && !malformed(selectorOf(r)));
  return kept.length ? `${head}${kept.join('')}}` : null;
}

export function build() {
  const files = readdirSync(SRC).filter((f) => f.endsWith('.css')).sort();
  const seen = new Set();
  const kept = [];
  let dropped = 0, total = 0;

  for (const f of files) {
    for (const chunk of chunks(readFileSync(join(SRC, f), 'utf8'))) {
      total++;
      const sel = selectorOf(chunk);
      // @media / @supports blocks are filtered inside rather than judged whole.
      if (/^\s*@(media|supports|container)/i.test(sel)) {
        const filtered = filterMedia(chunk);
        if (!filtered) { dropped++; continue; }
        if (seen.has(filtered)) continue;
        seen.add(filtered); kept.push(filtered);
        continue;
      }
      // @font-face, @keyframes, :root and plain rules.
      if (LEGACY.test(sel) || malformed(sel)) { dropped++; continue; }
      if (seen.has(chunk)) continue;
      seen.add(chunk); kept.push(chunk);
    }
  }

  const css = [
    '/* sidemoney.co frontend stylesheet.',
    '   TAKEN from the reference site at localhost:10025 — its own theme files,',
    '   already responsive, with the old builder\'s rules filtered out. Not',
    '   derived, not generated. See PORTING.md. */',
    ...kept,
  ].join('\n');

  const survivors = chunks(css).filter((c) => LEGACY.test(selectorOf(c)));
  writeFileSync(OUT, css);
  console.log(`source files    : ${files.length}`);
  console.log(`rules in        : ${total}`);
  console.log(`rules kept      : ${kept.length}`);
  console.log(`rules dropped   : ${dropped} (legacy builder)`);
  console.log(`@media kept     : ${(css.match(/@media/g) || []).length}`);
  console.log(`theme .c- refs  : ${(css.match(/\.c-/g) || []).length}`);
  console.log(`bytes           : ${css.length}`);
  console.log(`LEGACY SELECTORS SURVIVING: ${survivors.length} ${survivors.length ? '<-- MUST BE 0' : '(clean)'}`);
  return survivors.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(build() ? 1 : 0);
}
