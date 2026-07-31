// Scoped editing: containment, the propose/apply gate, and the diff.
//
// The containment tests are the ones that matter. Everything else here is
// convenience; those are the security boundary.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { disconnectDb } from '../dist/lib/db.js';
import { disconnectRedis } from '../dist/lib/redis.js';
import { closeQueues } from '../dist/lib/queue.js';
import { unifiedDiff } from '../dist/lib/unifiedDiff.js';
import { scopedFilesService, resolveWithin, EDITABLE_ROOTS } from '../dist/services/scopedFiles.service.js';
import { editProposalService } from '../dist/services/editProposal.service.js';
import { findTool } from '../dist/lib/mcpTools.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const bricksDir = EDITABLE_ROOTS.find((r) => r.id === 'bricks').dir;
const SANDBOX = 'agent-test-sandbox';
const sandboxDir = join(bricksDir, SANDBOX);
const rel = `${SANDBOX}/probe.css`;

async function seed(content) {
  await mkdir(sandboxDir, { recursive: true });
  await writeFile(join(sandboxDir, 'probe.css'), content, 'utf8');
}

after(async () => {
  await rm(sandboxDir, { recursive: true, force: true });
  // closeQueues is the one that actually matters here, and it is not obvious:
  // this file imports mcpTools, whose module-level `import { importQueue }`
  // constructs a BullMQ queue and therefore a live Redis connection. Without
  // closing it the runner hangs after the last assertion passes — the whole
  // suite timed out at 606s that way, with every test reported green.
  await closeQueues().catch(() => {});
  await disconnectDb().catch(() => {});
  await disconnectRedis().catch(() => {});
});

// ── Containment ───────────────────────────────────────────────────────

test('traversal out of a root is refused', async () => {
  for (const bad of ['../../.env', '../../../etc/passwd', '..', '../package.json']) {
    await assert.rejects(() => resolveWithin('bricks', bad), /escapes|not editable/i, `refused: ${bad}`);
  }
});

test('an absolute path cannot escape the root', async () => {
  // resolve() treats an absolute second argument as the whole path, so this
  // is the case a naive join() would let straight through.
  await assert.rejects(() => resolveWithin('bricks', '/etc/passwd'), /escapes|not editable/i);
  await assert.rejects(() => resolveWithin('bricks', join(repoRoot, '.env')), /escapes|not editable/i);
});

test('a null byte is refused before it reaches a syscall', async () => {
  await assert.rejects(() => resolveWithin('bricks', 'ok.css\0.png'), /Invalid path/i);
});

test('extensions outside the root allow-list are refused', async () => {
  for (const bad of ['x.ts', 'x.env', 'x.sh', 'x']) {
    await assert.rejects(() => resolveWithin('bricks', bad), /not editable/i, `refused: ${bad}`);
  }
});

test('unknown roots are refused', async () => {
  await assert.rejects(() => resolveWithin('src', 'index.ts'), /Unknown root/i);
  await assert.rejects(() => resolveWithin('', 'x.css'), /Unknown root/i);
});

test('a symlink pointing out of the root is refused', async () => {
  // The check people skip: the path is inside the root, but what it resolves
  // to is not.
  await mkdir(sandboxDir, { recursive: true });
  const link = join(sandboxDir, 'escape.css');
  await rm(link, { force: true });
  await symlink(join(repoRoot, 'package.json'), link).catch(() => null);
  await assert.rejects(() => resolveWithin('bricks', `${SANDBOX}/escape.css`), /symlink/i);
  await rm(link, { force: true });
});

test('the editable surface is exactly bricks and chrome CSS', () => {
  assert.deepEqual(EDITABLE_ROOTS.map((r) => r.id).sort(), ['bricks', 'chrome-css']);
  for (const r of EDITABLE_ROOTS) {
    assert.ok(!r.dir.endsWith('/src'), 'src is not editable');
    assert.ok(!r.dir.endsWith('/admin'), 'admin is not editable');
    assert.ok(r.extensions.every((e) => e.startsWith('.')), 'extensions are suffixes');
  }
});

// ── The propose / apply gate ──────────────────────────────────────────

test('propose writes nothing', async () => {
  await seed('a { color: red; }\n');
  const p = await editProposalService.proposeFile('bricks', rel, 'a { color: blue; }\n');
  assert.ok(p.id);
  assert.match(p.diff, /-a \{ color: red; \}/);
  assert.match(p.diff, /\+a \{ color: blue; \}/);
  // The file on disk is untouched until apply.
  assert.equal(await scopedFilesService.read('bricks', rel), 'a { color: red; }\n');
});

test('a no-op edit is refused rather than proposed', async () => {
  await seed('same\n');
  await assert.rejects(() => editProposalService.proposeFile('bricks', rel, 'same\n'), /no change/i);
});

test('apply writes the reviewed content and cannot be replayed', async () => {
  await seed('one\n');
  const p = await editProposalService.proposeFile('bricks', rel, 'two\n');
  const res = await editProposalService.apply(p.id);
  assert.equal(res.applied, true);
  assert.equal(await scopedFilesService.read('bricks', rel), 'two\n');
  // An id is single-use: otherwise an approval could be replayed later.
  await assert.rejects(() => editProposalService.apply(p.id), /already been applied/i);
});

test('apply refuses when the file moved under the proposal', async () => {
  await seed('original\n');
  const p = await editProposalService.proposeFile('bricks', rel, 'proposed\n');
  // Someone else edits it after the human reviewed the diff.
  await scopedFilesService.write('bricks', rel, 'changed by someone else\n');
  await assert.rejects(() => editProposalService.apply(p.id), /changed since/i);
  // And the other edit survives — apply did not overwrite it.
  assert.equal(await scopedFilesService.read('bricks', rel), 'changed by someone else\n');
});

test('an unknown or discarded proposal id is refused', async () => {
  await assert.rejects(() => editProposalService.apply('does-not-exist'), /No such proposal/i);
  await seed('x\n');
  const p = await editProposalService.proposeFile('bricks', rel, 'y\n');
  assert.equal(editProposalService.discard(p.id), true);
  await assert.rejects(() => editProposalService.apply(p.id), /No such proposal/i);
});

test('proposals never expose file contents in the list view', async () => {
  await seed('secret-looking content\n');
  await editProposalService.proposeFile('bricks', rel, 'other\n');
  const listed = editProposalService.list();
  for (const item of listed) {
    assert.ok(!('before' in item), 'before is withheld');
    assert.ok(!('after' in item), 'after is withheld');
  }
});

// ── MCP surface ───────────────────────────────────────────────────────

test('apply_edit is the only write-flagged editing tool', () => {
  assert.equal(findTool('apply_edit').write, true);
  for (const name of ['list_editable_files', 'read_editable_file', 'propose_edit', 'host_scan']) {
    const t = findTool(name);
    assert.ok(t, `${name} is registered`);
    assert.notEqual(t.write, true, `${name} must not be write-flagged`);
  }
});

test('propose_edit through MCP returns a diff and writes nothing', async () => {
  await seed('mcp before\n');
  const t = findTool('propose_edit');
  const res = await t.handler({ root: 'bricks', path: rel, content: 'mcp after\n' });
  assert.ok(!res.isError, res.content[0].text);
  const payload = JSON.parse(res.content[0].text);
  assert.ok(payload.proposalId);
  assert.match(payload.diff, /\+mcp after/);
  assert.equal(await scopedFilesService.read('bricks', rel), 'mcp before\n');
});

test('MCP read refuses a traversal path with an error, not a throw', async () => {
  const res = await findTool('read_editable_file').handler({ root: 'bricks', path: '../../.env' });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /escapes|not editable/i);
});

// ── Diff ──────────────────────────────────────────────────────────────

test('unified diff reports identical content rather than an empty patch', () => {
  const d = unifiedDiff('a\nb\n', 'a\nb\n');
  assert.equal(d.stats.identical, true);
  assert.equal(d.text, '');
});

test('unified diff counts additions and removals and keeps context', () => {
  const before = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].join('\n');
  const after = ['1', '2', '3', '4', 'FIVE', '6', '7', '8', '9', '10'].join('\n');
  const d = unifiedDiff(before, after, 'x');
  assert.equal(d.stats.added, 1);
  assert.equal(d.stats.removed, 1);
  assert.match(d.text, /^--- x/m);
  assert.match(d.text, /^-5$/m);
  assert.match(d.text, /^\+FIVE$/m);
  // Context, not the whole file: line 1 is 4 lines away from the change.
  assert.doesNotMatch(d.text, /^ 1$/m);
});

test('a very large file degrades to a summary instead of hanging', () => {
  // The chrome CSS is ~30k lines; an LCS table for that is hundreds of
  // millions of cells.
  const big = Array.from({ length: 7000 }, (_, i) => `line ${i}`).join('\n');
  const d = unifiedDiff(big, `${big}\nextra`, 'huge.css');
  assert.match(d.text, /too large to diff/i);
  assert.equal(d.stats.identical, false);
});
