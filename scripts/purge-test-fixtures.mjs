// One-off cleanup for integration-test fixture rows that accumulated in the
// shared dev DB before integration.test.mjs / content.test.mjs cleaned up
// after themselves. Safe to re-run — matches by name/slug prefix only.
// Run: node --env-file=.env scripts/purge-test-fixtures.mjs
import { db, disconnectDb } from '../dist/lib/db.js';

const extensions = await db.extension.deleteMany({ where: { name: { startsWith: 'it-ext-' } } });
const content = await db.content.deleteMany({
  where: { OR: [{ slug: { startsWith: 'it-folio-' } }, { slug: { startsWith: 'it-render-' } }] },
});

console.log(`Deleted ${extensions.count} extension row(s) (it-ext-*)`);
console.log(`Deleted ${content.count} content row(s) (it-folio-*, it-folio-dup-*, it-render-*)`);

await disconnectDb();
