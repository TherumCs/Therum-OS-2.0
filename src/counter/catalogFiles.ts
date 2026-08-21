import { parseDelimited } from './catalogImport.js';

// Turning a FILE into rows.
//
// The mapping step (catalogImport.ts) already handles everything once a
// catalogue is a grid of strings. This is the part that gets it there from
// whatever the supplier actually sent — a CSV, a spreadsheet, or a PDF nobody
// intended a computer to read.
//
// Each format returns the same shape, so nothing downstream knows or cares
// which one it came from.

export type SourceKind = 'delimited' | 'xlsx' | 'pdf';

export interface ExtractedFile {
  kind: SourceKind;
  /** Row 0 is the header. */
  rows: string[][];
  /** Images found inside the file, in page order. PDFs only. */
  images: { page: number; index: number; dataUrl: string }[];
  /** What the extractor had to guess, in plain words, for the operator. */
  notes: string[];
}

export function kindFromFilename(name: string, mimetype?: string): SourceKind {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf') || mimetype === 'application/pdf') return 'pdf';
  if (n.endsWith('.xlsx') || n.endsWith('.xlsm') || n.endsWith('.xls')) return 'xlsx';
  return 'delimited';
}

// ── Spreadsheets ────────────────────────────────────────────────────────

async function fromXlsx(buffer: Buffer): Promise<ExtractedFile> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return { kind: 'xlsx', rows: [], images: [], notes: ['That workbook has no sheets.'] };

  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    // eachCell skips empties, which would shift columns left — walk by index.
    const width = Math.max(sheet.columnCount, row.cellCount);
    for (let c = 1; c <= width; c += 1) {
      values.push(cellText(row.getCell(c).value));
    }
    if (values.some((v) => v.trim() !== '')) rows.push(values.map((v) => v.trim()));
  });

  const notes: string[] = [];
  if (wb.worksheets.length > 1) {
    notes.push(`Only the first sheet ("${sheet.name}") was read — this workbook has ${wb.worksheets.length}.`);
  }
  return { kind: 'xlsx', rows, images: [], notes };
}

/** A cell can be a formula, a hyperlink, a date or rich text — flatten it. */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    // A formula cell carries its computed result; that is what a human sees.
    if ('result' in o) return cellText(o.result);
    if ('text' in o) return cellText(o.text);
    if ('hyperlink' in o) return String(o.hyperlink);
    if ('richText' in o && Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((r) => r.text ?? '').join('');
    }
  }
  return String(v);
}

// ── PDFs ────────────────────────────────────────────────────────────────

/**
 * A PDF has no rows. It has glyphs at coordinates.
 *
 * So: take every text item with its position, group items that share a
 * baseline into a LINE, then work out where the columns are by looking at
 * which x-positions recur down the page. That reads a tabular catalogue well.
 * A free-form designed brochure is not a table and will not become one — the
 * notes say so rather than quietly producing nonsense.
 */
async function fromPdf(buffer: Buffer): Promise<ExtractedFile> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // No system fonts: this runs on the server against a file someone else
  // produced, and font loading is a needless surface. (pdfjs v6 dropped
  // isEvalSupported — it no longer evaluates anything.)
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: false });
  const doc = await task.promise;

  const lines: { page: number; y: number; items: { x: number; w: number; text: string }[] }[] = [];
  const images: { page: number; index: number; dataUrl: string }[] = [];

  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const byBaseline = new Map<number, { x: number; w: number; text: string }[]>();
    for (const item of content.items as { str?: string; width?: number; transform?: number[] }[]) {
      const text = (item.str ?? '').trim();
      if (!text) continue;
      const x = item.transform?.[4] ?? 0;
      const y = item.transform?.[5] ?? 0;
      // Width matters: the GAP between two items is what says whether they are
      // two words in one cell or two different columns.
      const w = item.width ?? text.length * ((item.transform?.[0] ?? 6) * 0.5);
      const key = Math.round(y / 3) * 3;
      byBaseline.set(key, [...(byBaseline.get(key) ?? []), { x, w, text }]);
    }
    for (const [y, items] of byBaseline) {
      lines.push({ page: p, y, items: items.sort((a, b) => a.x - b.x) });
    }
    images.push(...(await pageImages(page, p, pdfjs.OPS.paintImageXObject)));
    page.cleanup();
  }

  // Top of the page downwards, page by page.
  lines.sort((a, b) => (a.page - b.page) || (b.y - a.y));

  const rows = dropLeadingBanner(linesToRows(lines));
  const notes: string[] = [`Read ${doc.numPages} page(s) — ${rows.length} row(s) of text and ${images.length} image(s).`];
  if (rows.length && (rows[0]?.length ?? 0) < 2) {
    notes.push('This PDF does not look tabular — every line came out as a single column. Map that column to Name and fill the rest in afterwards, or use a CSV if you have one.');
  }
  if (images.length) {
    notes.push('Images are listed in page order. They are attached to rows in the same order, so check the first few before importing.');
  }
  await task.destroy();
  return { kind: 'pdf', rows, images, notes };
}

/**
 * Drop the title above the table.
 *
 * A catalogue PDF opens with a name, a date, a page header — lines that are
 * one cell wide while the table below is three. Row 0 is then taken as the
 * header, the REAL header becomes a data row, and every column is mislabelled.
 *
 * The table's own width is the giveaway: it is whatever most rows have. Rows
 * before the first one of that width are the banner.
 */
function dropLeadingBanner(rows: string[][]): string[][] {
  if (rows.length < 3) return rows;
  const widths = rows.map((r) => r.filter((c) => c.trim() !== '').length);
  const tally = new Map<number, number>();
  for (const w of widths) tally.set(w, (tally.get(w) ?? 0) + 1);
  let modal = 1;
  let best = 0;
  for (const [w, n] of tally) if (w > 1 && n > best) { best = n; modal = w; }
  if (modal < 2) return rows;
  const firstFull = widths.findIndex((w) => w >= modal);
  // Never eat the whole file chasing a header that is not there.
  return firstFull > 0 && firstFull < rows.length - 1 ? rows.slice(firstFull) : rows;
}

/**
 * Turn positioned lines into columns.
 *
 * The x-positions that repeat down the page ARE the columns — that is what
 * makes a table look like a table to a human, and it survives the fact that
 * PDF has no idea a table exists.
 */
function linesToRows(lines: { page: number; y: number; items: { x: number; w: number; text: string }[] }[]): string[][] {
  if (!lines.length) return [];

  // STEP 1 — words into cells, by GAP.
  //
  // pdfjs emits a text item per word, so "Yuzu Kit Kat" arrives as three. An
  // earlier version clustered raw item positions straight into columns and
  // duly split that product's name across two columns, because the second
  // word happened to start at a recurring x. A column boundary is not "a new
  // item", it is a WIDE gap — inside a cell the gap is one space.
  const gaps: number[] = [];
  for (const line of lines) {
    for (let i = 1; i < line.items.length; i += 1) {
      const prev = line.items[i - 1]!;
      const gap = line.items[i]!.x - (prev.x + prev.w);
      if (gap > 0) gaps.push(gap);
    }
  }
  const cellBreak = wordVsColumnThreshold(gaps);

  const celled = lines.map((line) => {
    // `end` is carried, not estimated. Estimating the width of the merged text
    // overshot, every gap came out negative, and the whole line merged into a
    // single cell — the opposite failure to the one this fixes.
    const cells: { x: number; end: number; text: string }[] = [];
    for (const item of line.items) {
      const last = cells[cells.length - 1];
      if (last && item.x - last.end < cellBreak) {
        last.text = `${last.text} ${item.text}`;
        last.end = item.x + item.w;
      } else {
        cells.push({ x: item.x, end: item.x + item.w, text: item.text });
      }
    }
    return cells;
  });

  // STEP 2 — cell starts that recur down the page are the columns.
  const starts = new Map<number, number>();
  for (const cells of celled) {
    for (const c of cells) {
      const bucket = Math.round(c.x / 10) * 10;
      starts.set(bucket, (starts.get(bucket) ?? 0) + 1);
    }
  }
  const threshold = Math.max(2, Math.floor(celled.length / 4));
  const columns = [...starts.entries()].filter(([, n]) => n >= threshold).map(([x]) => x).sort((a, b) => a - b);

  if (columns.length < 2) return celled.map((cells) => [cells.map((c) => c.text).join(' ')]);

  return celled.map((cells) => {
    const out = new Array<string>(columns.length).fill('');
    for (const c of cells) {
      let ci = 0;
      for (let i = 0; i < columns.length; i += 1) if (c.x + 5 >= (columns[i] ?? 0)) ci = i;
      out[ci] = out[ci] ? `${out[ci]} ${c.text}` : c.text;
    }
    return out.map((v) => v.trim());
  });
}


/**
 * Where a word space stops and a column gap starts.
 *
 * The gaps on a table page are bimodal: a cluster of small ones (spaces
 * between words) and a cluster of large ones (the gutters between columns).
 * The threshold belongs in the jump between them, so this finds the biggest
 * PROPORTIONAL step in the sorted gaps and splits there.
 *
 * The median does not work, and that is worth recording: on a sparse table
 * most gaps are column gaps, so the median lands inside the large cluster and
 * every column merges into one. Measured on a real 3-column page: gaps ran
 * 7 7 7 7 22 36 58 65 65 65 79 86 — median 58, and the correct answer is
 * somewhere between 7 and 22.
 */
export function wordVsColumnThreshold(gaps: number[]): number {
  const sorted = [...gaps].filter((g) => g > 0).sort((a, b) => a - b);
  if (sorted.length < 2) return Infinity; // nothing to split on: one cell
  let bestRatio = 1;
  let cut = Infinity;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const lo = sorted[i]!;
    const hi = sorted[i + 1]!;
    const ratio = hi / Math.max(lo, 1);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      // Geometric midpoint, so the threshold sits between the clusters
      // rather than on the edge of one.
      cut = Math.sqrt(lo * hi);
    }
  }
  if (bestRatio >= 1.8) return cut;

  // NO CLEAR JUMP. Two very different situations look like this, and the
  // absolute size tells them apart.
  //
  // Some producers (Chrome's print-to-PDF among them) emit a whole CELL as one
  // text item, so a table page has no word gaps at all — every gap present is
  // a column gap, and they are all wide. Measured on such a page: 14 22 29 46
  // 59, best ratio 1.59, and treating that as prose merged the entire table
  // into a single column.
  //
  // Prose, by contrast, is nothing but word gaps, and those are small.
  const smallest = sorted[0]!;
  if (smallest >= 10) return smallest / 2; // all gaps are columns
  return Infinity;                          // all gaps are word spaces
}

const MAX_PDF_IMAGE_BYTES = 8 * 1024 * 1024;

/** Embedded images, as data URLs, so the browser can show them for matching. */
interface PdfObjs {
  get: (name: string, callback?: (value: unknown) => void) => unknown;
  has?: (name: string) => boolean;
}

/**
 * Wait for a pdfjs object to resolve.
 *
 * Image XObjects are decoded ASYNCHRONOUSLY. Asking for them straight after
 * getOperatorList returns the first one and throws "isn't resolved yet" for
 * the rest — a three-image catalogue page yielded one image, or none,
 * depending on timing. The two-argument form of objs.get registers a callback
 * instead, which fires when the object is ready.
 */
function resolveObj(objs: PdfObjs, name: string): Promise<unknown> {
  return new Promise((resolve) => {
    // A file that never resolves an object must not hang the whole request.
    const timer = setTimeout(() => resolve(null), 10_000);
    const done = (value: unknown): void => { clearTimeout(timer); resolve(value); };
    try {
      if (objs.has?.(name)) { done(objs.get(name)); return; }
      objs.get(name, done);
    } catch {
      done(null);
    }
  });
}

async function pageImages(
  page: { getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>; objs: PdfObjs },
  pageNo: number,
  paintImageOp: number,
): Promise<{ page: number; index: number; dataUrl: string }[]> {
  const out: { page: number; index: number; dataUrl: string }[] = [];
  try {
    const ops = await page.getOperatorList();
    const names: string[] = [];
    for (let i = 0; i < ops.fnArray.length; i += 1) {
      if (ops.fnArray[i] !== paintImageOp) continue;
      const name = (ops.argsArray[i]?.[0] ?? '') as string;
      if (name && !names.includes(name)) names.push(name);
      if (names.length >= 60) break; // a design-heavy PDF has hundreds of fragments
    }
    let index = 0;
    for (const name of names) {
      const img = await resolveObj(page.objs, name);
      const record = img as { width?: number; height?: number; data?: Uint8ClampedArray | Uint8Array };
      if (!record?.data || !record.width || !record.height) continue;
      const png = await rgbaToPng(record.data, record.width, record.height);
      if (!png || png.length > MAX_PDF_IMAGE_BYTES) continue;
      out.push({ page: pageNo, index: index++, dataUrl: `data:image/png;base64,${png.toString('base64')}` });
    }
  } catch {
    // An unreadable image stream must not lose the text we already have.
  }
  return out;
}

async function rgbaToPng(data: Uint8ClampedArray | Uint8Array, width: number, height: number): Promise<Buffer | null> {
  try {
    const sharp = (await import('sharp')).default;
    const channels = data.length / (width * height);
    if (channels !== 3 && channels !== 4) return null;
    return await sharp(Buffer.from(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength), {
      raw: { width, height, channels: channels as 3 | 4 },
    }).png().toBuffer();
  } catch {
    return null;
  }
}

// ── The one entry point ─────────────────────────────────────────────────

export async function extract(buffer: Buffer, filename: string, mimetype?: string): Promise<ExtractedFile> {
  const kind = kindFromFilename(filename, mimetype);
  if (kind === 'xlsx') return fromXlsx(buffer);
  if (kind === 'pdf') return fromPdf(buffer);
  return { kind: 'delimited', rows: parseDelimited(buffer.toString('utf8')), images: [], notes: [] };
}
