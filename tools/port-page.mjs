// Ports a plain content page from the live source site into 2.0's CMS.
//
// Usage: node --env-file=.env tools/port-page.mjs <slug> [outSlug]
//
// Scope, deliberately: PLAIN pages — policy/legal/info pages whose value is
// their text. It lifts the source's `.entry-content` verbatim into a single
// Bricks `text` node, which is the same mechanism the ideapark widgets were
// ported with (render.ts emits p.content raw for that node type).
//
// It does NOT attempt layout-heavy pages. Those went through the measured
// computed-style diff pipeline in bricks-child; running them through here
// would produce something that looks approximately right and silently isn't.
//
// The source is READ-ONLY (CLAUDE.md): this only ever GETs from it.

import { db, disconnectDb } from '../dist/lib/db.js';

const SOURCE = process.env.PORT_SOURCE ?? 'http://localhost:8080';

function extractEntryContent(html) {
  // The source wraps page copy in .entry-content. Matching the OPEN tag then
  // walking divs keeps nested markup intact — a lazy regex to the first
  // </div> truncates every page that contains one.
  const open = html.search(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>/);
  if (open < 0) return null;
  const start = html.indexOf('>', open) + 1;
  let depth = 1;
  let i = start;
  const tag = /<\/?div\b/gi;
  tag.lastIndex = start;
  let m;
  while ((m = tag.exec(html))) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) { i = m.index; break; }
  }
  return html.slice(start, i);
}

function clean(html) {
  return html
    // Scripts from the source theme reference jQuery/Owl we do not ship;
    // leaving them in throws on every page load.
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    // LiteSpeed lazy-loading swaps the real src out for a placeholder; promote
    // it back or every image renders as a grey box.
    .replace(/\sdata-lazyloaded="[^"]*"/gi, '')
    .replace(/\ssrc="data:image\/gif[^"]*"/gi, '')
    .replace(/\sdata-src="/gi, ' src="')
    .replace(/\sdata-srcset="/gi, ' srcset="')
    // Absolute links back to the source would walk the visitor off this site.
    .replace(new RegExp(SOURCE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '')
    .trim();
}

function titleOf(html, fallback) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  if (!m) return fallback;
  const title = m[1]
    .replace(/&#8211;/g, '–')
    .replace(/&amp;/g, '&');
  // WordPress renders <title> as "Page Title <sep> Site Name". Strip the
  // trailing site-name segment so the ported page keeps only its own title.
  // Set PORT_TITLE_SUFFIX to the source site's name for an exact match;
  // otherwise the segment after the last separator is dropped.
  const suffix = process.env.PORT_TITLE_SUFFIX;
  const stripped = suffix
    ? title.split(new RegExp(`\\s+[–|-]\\s+${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))[0]
    : title.replace(/\s+[–|-]\s+[^–|-]+$/, '');
  return stripped.trim();
}

const [slug, outSlugArg] = process.argv.slice(2);
if (!slug) {
  console.error('usage: port-page.mjs <source-slug> [target-slug]');
  process.exit(1);
}
const outSlug = outSlugArg ?? slug;

const res = await fetch(`${SOURCE}/${slug}/`, { redirect: 'follow' });
if (!res.ok) {
  console.error(`  ${slug}: source returned ${res.status}`);
  process.exit(1);
}
const html = await res.text();
const raw = extractEntryContent(html);
if (!raw) {
  console.error(`  ${slug}: no .entry-content — this page is layout-built, not a plain page. Skipping rather than importing something wrong.`);
  process.exit(2);
}
const content = clean(raw);
const title = titleOf(html, outSlug);

const body = {
  id: `port-${outSlug}`,
  type: 'section',
  props: { __name: 'section' },
  children: [
    {
      id: `port-${outSlug}-wrap`,
      type: 'container',
      props: { __name: 'container' },
      children: [
        { id: `port-${outSlug}-text`, type: 'text', props: { __name: 'text-basic', content }, children: [] },
      ],
    },
  ],
};

const existing = await db.content.findFirst({ where: { slug: outSlug } });
const data = {
  type: 'page',
  title,
  slug: outSlug,
  status: 'published',
  body,
  bodyFormat: 'canvas',
  publishedAt: new Date(),
};
if (existing) {
  await db.content.update({ where: { id: existing.id }, data });
} else {
  await db.content.create({ data });
}

const words = content.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;
console.log(`  ${existing ? 'updated' : 'created'}  /${outSlug.padEnd(24)} "${title}"  ${words} words`);
await disconnectDb();
