// A unified diff, written here rather than pulled in as a dependency: the
// whole job is "show a human what would change before they approve it", and
// that is a few dozen lines of LCS. A diff library would be a supply-chain
// surface for something this contained.

export interface DiffStats {
  added: number;
  removed: number;
  /** True when the two texts are identical — the caller should refuse to
   *  create a proposal that changes nothing. */
  identical: boolean;
}

export interface UnifiedDiff {
  text: string;
  stats: DiffStats;
}

/** Longest common subsequence over LINES, as a table of back-pointers. */
function lcsLengths(a: string[], b: string[]): number[][] {
  // (a.length+1) x (b.length+1). Fine for source files; a 1.1 MB CSS file is
  // ~30k lines, which is a 900M-cell table — see the guard in unifiedDiff.
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}

type Op = { kind: ' ' | '-' | '+'; line: string };

function diffOps(a: string[], b: string[]): Op[] {
  const table = lcsLengths(a, b);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: ' ', line: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      ops.push({ kind: '-', line: a[i]! });
      i++;
    } else {
      ops.push({ kind: '+', line: b[j]! });
      j++;
    }
  }
  while (i < a.length) ops.push({ kind: '-', line: a[i++]! });
  while (j < b.length) ops.push({ kind: '+', line: b[j++]! });
  return ops;
}

/** Line count above which we stop trying to produce a real diff. The ported
 *  chrome CSS is ~30k lines; an LCS table for that is hundreds of millions of
 *  cells and would take the process down. Better to say so than to hang. */
const MAX_DIFF_LINES = 6000;

const CONTEXT = 3;

/**
 * Unified diff of `before` -> `after`, with 3 lines of context.
 *
 * Returns a `text` suitable for showing to a human. This is deliberately NOT
 * a machine-appliable patch: applying happens by writing the full new content
 * that was proposed, so there is no chance of a patch applying cleanly to a
 * file that has changed underneath it.
 */
export function unifiedDiff(before: string, after: string, label = 'file'): UnifiedDiff {
  if (before === after) {
    return { text: '', stats: { added: 0, removed: 0, identical: true } };
  }
  const a = before.split('\n');
  const b = after.split('\n');

  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    const added = Math.max(0, b.length - a.length);
    const removed = Math.max(0, a.length - b.length);
    return {
      text:
        `--- ${label}\n+++ ${label}\n` +
        `@@ file too large to diff (${a.length} -> ${b.length} lines) @@\n` +
        'A line-by-line diff is not produced above 6000 lines. Review the change at its source.',
      stats: { added, removed, identical: false },
    };
  }

  const ops = diffOps(a, b);
  const added = ops.filter((o) => o.kind === '+').length;
  const removed = ops.filter((o) => o.kind === '-').length;

  // Only emit hunks around actual changes — a whole-file dump is not a review.
  const changed = ops.map((o) => o.kind !== ' ');
  const keep = new Array<boolean>(ops.length).fill(false);
  for (let i = 0; i < ops.length; i++) {
    if (!changed[i]) continue;
    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(ops.length - 1, i + CONTEXT); k++) keep[k] = true;
  }

  const lines: string[] = [`--- ${label}`, `+++ ${label}`];
  let aLine = 1;
  let bLine = 1;
  let i = 0;
  while (i < ops.length) {
    if (!keep[i]) {
      if (ops[i]!.kind !== '+') aLine++;
      if (ops[i]!.kind !== '-') bLine++;
      i++;
      continue;
    }
    const hunkStartA = aLine;
    const hunkStartB = bLine;
    const body: string[] = [];
    let countA = 0;
    let countB = 0;
    while (i < ops.length && keep[i]) {
      const op = ops[i]!;
      body.push(op.kind + op.line);
      if (op.kind !== '+') { aLine++; countA++; }
      if (op.kind !== '-') { bLine++; countB++; }
      i++;
    }
    lines.push(`@@ -${hunkStartA},${countA} +${hunkStartB},${countB} @@`);
    lines.push(...body);
  }

  return { text: lines.join('\n'), stats: { added, removed, identical: false } };
}
