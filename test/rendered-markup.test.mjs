// Guards on the HTML the site actually emits.
//
// These exist because a content edit swallowed three footer columns into a
// <script> element and the page still returned 200. Nothing in the suite could
// see it: every check we had asked whether a request succeeded, not whether the
// markup it returned was intact. Bam's rule is that continued fixes must not
// break layouts, and a rule with no check is a wish.
//
// Deliberately offline — these parse stored content and rendered strings rather
// than driving a browser, so they run in the normal suite. The browser-level
// comparison against the reference site lives in tools/visual-compare.mjs.
import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderCanvas } from '../dist/lib/render.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { closeQueues } from '../dist/lib/queue.js';

after(async () => {
  await closeQueues();
  await disconnectDb();
});

/** Every <script> a fragment opens must be closed by a literal </script>. */
function unclosedScripts(html) {
  const opens = (html.match(/<script\b/gi) ?? []).length;
  // Only a literal </script> ends a script element. `<\/script>` is a
  // JavaScript string escape and does nothing in raw HTML — that is the exact
  // typo that ate the footer.
  const closes = (html.match(/<\/script\s*>/gi) ?? []).length;
  return opens - closes;
}

describe('rendered content markup', () => {
  test('no stored content opens a <script> it never closes', async () => {
    const rows = await db.content.findMany({
      where: { deletedAt: null },
      select: { slug: true, body: true },
    });
    assert.ok(rows.length, 'expected some content to check');
    const broken = [];
    for (const row of rows) {
      const html = renderCanvas(row.body);
      const open = unclosedScripts(html);
      if (open !== 0) broken.push(`${row.slug} (${open > 0 ? `${open} unclosed` : `${-open} stray closing`})`);
    }
    assert.deepEqual(broken, [], `content renders unbalanced <script> tags: ${broken.join(', ')}`);
  });

  test('the escaped closing tag that ate the footer never reaches the page', async () => {
    const rows = await db.content.findMany({ where: { deletedAt: null }, select: { slug: true, body: true } });
    const offenders = rows
      .map((r) => [r.slug, JSON.stringify(r.body)])
      .filter(([, raw]) => raw.includes('<\\/script>'))
      .map(([slug]) => slug);
    assert.deepEqual(offenders, [], `stored content contains <\\/script>, which does not close a tag in HTML: ${offenders.join(', ')}`);
  });

  test('the chrome templates render non-empty — they are on every page', async () => {
    // Header and footer are single rows reused site-wide, so breaking one
    // breaks every page at once. That blast radius earns its own check.
    for (const slug of ['site-header', 'site-footer']) {
      const row = await db.content.findFirst({ where: { slug }, select: { body: true } });
      if (!row) continue; // a store that has not imported chrome is not broken
      const html = renderCanvas(row.body);
      assert.ok(html.length > 500, `${slug} rendered only ${html.length} chars — it is chrome for the whole site`);
      assert.equal(unclosedScripts(html), 0, `${slug} has unbalanced <script> tags`);
    }
  });

  test('the footer keeps its four columns', async () => {
    // The concrete regression: three of these vanished and every page still
    // answered 200. Pinned by id because that is what the stylesheet targets.
    const row = await db.content.findFirst({ where: { slug: 'site-footer' }, select: { body: true } });
    if (!row) return;
    const html = renderCanvas(row.body);
    for (const id of ['81f7b20', '11abed2', '49e3faf', '48957b7']) {
      assert.match(html, new RegExp(`elementor-element-${id}\\b`), `footer column ${id} is missing from the rendered chrome`);
    }
  });
});
