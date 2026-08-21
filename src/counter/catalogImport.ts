import { db } from '../lib/db.js';
import { mediaService } from '../services/media.service.js';
import { slugify } from '../lib/slug.js';

// Catalogue import with FIELD MAPPING.
//
// The point of this is the mapping step. Every store's export names its columns
// differently — "Product Name", "title", "Item", "Artikel" — and an importer
// that insists on its own header names makes you rewrite the file by hand
// before it will read it. This reads whatever headers the file has, guesses
// which of ours each one means, and then lets a human correct the guesses
// before anything is written.
//
// Nothing is created until commit. Analyse is read-only.

export type TargetField =
  | 'name'
  | 'description'
  | 'price'
  | 'sku'
  | 'image'
  | 'category'
  | 'tags'
  | 'status'
  | 'stock'
  | 'ignore';

export const TARGET_FIELDS: { id: TargetField; label: string; hint: string }[] = [
  { id: 'name', label: 'Name', hint: 'Required. The product title.' },
  { id: 'price', label: 'Price', hint: 'Currency symbols and thousands separators are fine.' },
  { id: 'description', label: 'Description', hint: 'Plain text or HTML.' },
  { id: 'sku', label: 'SKU', hint: 'Stored on the variant.' },
  { id: 'image', label: 'Image URL', hint: 'Fetched and stored locally on import.' },
  { id: 'category', label: 'Category', hint: 'A path like "mens/t-shirts" nests; a bare name is top level.' },
  { id: 'tags', label: 'Tags', hint: 'Separated by comma, semicolon or pipe.' },
  { id: 'stock', label: 'Stock', hint: 'Whole number.' },
  { id: 'status', label: 'Status', hint: 'active, draft or archived. Defaults to draft.' },
  { id: 'ignore', label: '— skip this column —', hint: '' },
];

// A LAST-RESORT hint only. Field detection reads the DATA (see inferMapping);
// these exist for the one case data cannot settle — telling two similar text
// columns apart when the file has no rows to judge by.
const HEADER_HINTS: Record<Exclude<TargetField, 'ignore'>, RegExp> = {
  name: /name|product|title|item|produkt|artikel|nombre|producto|nom|produit|prodotto/i,
  price: /price|cost|amount|rrp|msrp|retail|preis|precio|prix|prezzo|importe/i,
  description: /desc|details|body|notes|about|beschreib|descri/i,
  sku: /sku|code|barcode|upc|ean|mpn|ref|codigo|codice|artikelnummer/i,
  image: /image|img|photo|picture|thumb|bild|imagen|foto|immagine/i,
  category: /categor|type|department|collection|group|kategorie|rubrique|gruppe/i,
  tags: /tags?|labels|keywords|schlagworte|etiquetas|etichette/i,
  stock: /stock|qty|quantit|inventory|on hand|available|menge|bestand|cantidad/i,
  status: /status|state|published|active|zustand|estado|stato/i,
};

/**
 * Split delimited text into rows.
 *
 * Hand-rolled rather than a dependency because the rules that matter are
 * small and the failure modes are specific: a quoted field may contain the
 * delimiter, a newline, or an escaped quote (""), and real exports from Excel
 * use all three. A naive split on "," corrupts exactly the rows a human would
 * never think to check.
 */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, ''); // Excel writes a BOM
  const delim = delimiter ?? sniffDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } // escaped quote
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === delim) { row.push(field); field = ''; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((v) => v.trim()));
}

/** Whichever of , ; \t | is most consistent across the first few lines. */
function sniffDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5);
  let best = ',';
  let bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => l.split(d).length - 1);
    if (!counts.length || counts[0] === 0) continue;
    // Consistent column counts beat a high count — a description full of
    // commas should not win over a genuine semicolon delimiter.
    const consistent = counts.every((c) => c === counts[0]);
    const score = (consistent ? 100 : 0) + (counts[0] ?? 0);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/**
 * What each column IS, decided by looking at the values.
 *
 * The first version of this matched header names against a list of words, then
 * grew a German, Spanish, French and Italian branch of that list — which is a
 * losing game: the next catalogue is in Japanese, or the header just says
 * "Col3". The data does not have that problem. A column of "$3.50 / $12.00 /
 * $4.25" is the price in any language, a column of URLs ending .jpg is the
 * image, and the longest prose is the description.
 *
 * Header text is still read, but only as a TIEBREAK — when two columns look
 * equally like a name, "Product" beats "Notes". Data always outranks it.
 */
interface ColumnProfile {
  values: string[];
  filled: number;
  currency: number;   // values carrying a currency symbol
  decimal: number;    // values that are a number with a fractional part
  integer: number;    // whole numbers
  url: number;
  imageUrl: number;
  avgLength: number;
  uniqueRatio: number;
  separated: number;  // values that look like a list ("a, b, c")
  pathish: number;    // values containing a / — a category path
  codeish: number;    // ABC-123 style identifiers
  numeric: number;    // parses as a number at all
}

const CURRENCY = /[$€£¥₩₹₽¢]|\b(usd|eur|gbp|jpy|cad|aud|chf)\b/i;

function profile(values: string[]): ColumnProfile {
  const filled = values.filter((v) => v.trim() !== '');
  const n = Math.max(1, filled.length);
  const count = (test: (v: string) => boolean): number => filled.filter(test).length / n;
  const numeric = (v: string): string => v.replace(/[^0-9.,-]/g, '');
  return {
    values: filled,
    filled: filled.length,
    currency: count((v) => CURRENCY.test(v) && /\d/.test(v)),
    decimal: count((v) => /^-?[\d.,\s]+$/.test(numeric(v)) && /[.,]\d{1,2}\s*$/.test(numeric(v))),
    integer: count((v) => /^\d{1,7}$/.test(v.trim())),
    url: count((v) => /^https?:\/\//i.test(v.trim())),
    imageUrl: count((v) => /^https?:\/\//i.test(v.trim()) && /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(v.trim())),
    avgLength: filled.reduce((sum, v) => sum + v.length, 0) / n,
    uniqueRatio: new Set(filled.map((v) => v.toLowerCase())).size / n,
    separated: count((v) => /[,;|]/.test(v) && v.split(/[,;|]/).every((p) => p.trim().length > 0 && p.trim().length < 30)),
    pathish: count((v) => /^[^/\s][^/]*\/[^/]+/.test(v.trim()) && !/^https?:/i.test(v.trim())),
    // A code has a LETTER in it (SKU-12, AB1234) or is a long all-digit
    // barcode. Without the letter requirement "1.00" matched, and a price
    // column was read as a SKU.
    // A code carries DIGITS (SKU-12, AB1234) or is a long all-digit barcode.
    // Requiring only "letters and no spaces" matched the word "snacks", and a
    // category column was read as a SKU.
    codeish: count((v) => {
      const t = v.trim();
      if (/^\d{8,14}$/.test(t)) return true;               // EAN / UPC
      if (/\s/.test(t) || t.length < 3) return false;
      return /\d/.test(t) && /[A-Za-z]/.test(t) && /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(t);
    }),
    numeric: count((v) => /^[^a-z]*\d[\d.,\s]*$/i.test(v.trim())),
  };
}

/** How strongly a column looks like a given field. 0 means "not this". */
function score(field: Exclude<TargetField, 'ignore'>, p: ColumnProfile, header: string): number {
  // The header is a TIEBREAK, not the mechanism — data signals (currency, a
  // URL, a number) are weighted several times higher, so a mislabelled column
  // still lands correctly. But when two readings are genuinely close, a header
  // that says "Long Description" is real evidence and should decide it.
  const hint = HEADER_HINTS[field].test(header) ? 1.2 : 0;
  if (!p.filled) return hint * 0.5; // nothing to judge but the header
  switch (field) {
    case 'image':
      // An image column is unmistakable, so it is scored highest of all.
      return p.imageUrl * 6 + p.url * 1.5 + hint;
    case 'price':
      // A currency symbol settles it outright. Failing that, decimals.
      return p.currency * 5 + p.decimal * 2.2 + hint - p.url * 3;
    case 'stock':
      // Whole numbers with no currency and no decimal point.
      return p.integer * 2.4 - p.currency * 4 - p.decimal * 2 + hint;
    case 'description':
      // The longest prose in the file. Length is the whole signal.
      return Math.min(p.avgLength / 25, 3) + hint - p.url * 2 - p.currency * 2 - p.numeric * 4;
    case 'name':
      // Short, distinct, TEXT — and not any of the above. The numeric penalty
      // is doing real work: a column of "1.00 / 2.00" is unique and short, so
      // without it a price column outscored the actual product name.
      return (p.uniqueRatio * 2.2)
        + (p.avgLength > 2 && p.avgLength < 60 ? 1.2 : 0)
        + hint - p.numeric * 5 - p.currency * 4 - p.url * 4 - p.pathish * 2;
    case 'category':
      // Repeats down the page (few distinct values), or reads as a path.
      return p.pathish * 3 + (1 - p.uniqueRatio) * 1.8 + hint - p.url * 3 - p.currency * 3 - p.separated * 1.2 - p.numeric * 3;
    case 'tags':
      // Tag lists are SHORT. Long comma-separated prose is a description that
      // happens to contain commas.
      return p.separated * 2.6 + (1 - p.uniqueRatio) * 0.6 + hint
        - Math.max(0, (p.avgLength - 14) / 12) - p.url * 3 - p.currency * 3;
    case 'sku':
      return p.codeish * 2.6 + p.uniqueRatio * 0.8 - (1 - p.uniqueRatio) * 2.5
        + hint - p.currency * 3 - p.url * 3 - p.decimal * 3;
    case 'status':
      // A handful of repeated short words.
      return (p.uniqueRatio < 0.3 && p.avgLength < 12 ? 1.4 : 0) + hint - p.url * 3 - p.currency * 3;
    default:
      return 0;
  }
}

const MIN_CONFIDENCE = 1.0;

/**
 * Assign fields to columns from the data, one field at a time, strongest first.
 *
 * @param rows sample rows WITHOUT the header. Passing none falls back to
 *             header text alone, which is the old, weaker behaviour.
 */
export function suggestMapping(headers: string[], rows: string[][] = []): TargetField[] {
  const profiles = headers.map((_, i) => profile(rows.map((r) => r[i] ?? '')));
  const out: TargetField[] = headers.map(() => 'ignore');

  // Every (column, field) pair scored, then taken best-first so the most
  // confident reading wins its column outright rather than the leftmost column
  // claiming a field it only weakly resembles.
  const fields = Object.keys(HEADER_HINTS) as Exclude<TargetField, 'ignore'>[];
  const candidates: { col: number; field: Exclude<TargetField, 'ignore'>; s: number }[] = [];
  headers.forEach((h, col) => {
    for (const field of fields) candidates.push({ col, field, s: score(field, profiles[col]!, h) });
  });
  candidates.sort((a, b) => b.s - a.s);

  const usedCols = new Set<number>();
  const usedFields = new Set<TargetField>();
  for (const c of candidates) {
    if (c.s < MIN_CONFIDENCE) break;
    if (usedCols.has(c.col) || usedFields.has(c.field)) continue;
    out[c.col] = c.field;
    usedCols.add(c.col);
    usedFields.add(c.field);
  }

  // A file with no Name yet is unusable, so the best remaining text column
  // takes it rather than leaving the operator to find it.
  if (!usedFields.has('name')) {
    let best = -1;
    let bestScore = -Infinity;
    headers.forEach((h, col) => {
      if (usedCols.has(col)) return;
      const s = score('name', profiles[col]!, h);
      if (s > bestScore) { bestScore = s; best = col; }
    });
    if (best >= 0) out[best] = 'name';
  }
  return out;
}

/** "$1,299.00" → 129900. Returns null when there is no number in there. */
export function parseMoneyToMinor(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.,-]/g, '').trim();
  if (!cleaned) return null;
  // Decide which separator is the decimal one: the LAST of . or , wins, which
  // handles both 1,299.00 and 1.299,00.
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let normalised = cleaned;
  if (lastDot >= 0 && lastComma >= 0) {
    normalised = lastDot > lastComma
      ? cleaned.replace(/,/g, '')
      : cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastComma >= 0) {
    // A lone comma is a decimal separator only when it looks like one.
    normalised = /,\d{1,2}$/.test(cleaned) ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  }
  const n = Number(normalised);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export interface AnalyzeResult {
  headers: string[];
  suggested: TargetField[];
  sample: string[][];
  totalRows: number;
  delimiter: string;
}

export function analyze(text: string): AnalyzeResult {
  const delim = sniffDelimiter(text.replace(/^﻿/, ''));
  const rows = parseDelimited(text, delim);
  if (!rows.length) return { headers: [], suggested: [], sample: [], totalRows: 0, delimiter: delim };
  const headers = rows[0] ?? [];
  const body = rows.slice(1);
  return {
    headers,
    suggested: suggestMapping(headers, body.slice(0, 40)),
    sample: body.slice(0, 5),
    totalRows: body.length,
    delimiter: delim,
  };
}

/**
 * Fetch a remote image into local media.
 *
 * SSRF GUARD. The URLs come from an uploaded file, so "the admin typed it" is
 * not true — a supplier's spreadsheet can point at 169.254.169.254 or
 * 127.0.0.1 and turn this server into a proxy for its own private network.
 * Only http(s), only public hosts, size-capped, and it must actually be an
 * image when it arrives.
 */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export function isFetchableUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return false;
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(host)) {
    const [a, b] = host.split('.').map(Number) as [number, number, number, number];
    if (a === 127 || a === 10 || a === 0) return false;
    if (a === 169 && b === 254) return false;            // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  if (host === '::1' || host.startsWith('fd') || host.startsWith('fe80')) return false;
  return true;
}

async function importImage(url: string, alt: string): Promise<string | null> {
  if (!isFetchableUrl(url)) return null;
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null;
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'image');
    const asset = await mediaService.upload({ filename: name.includes('.') ? name : `${name}.jpg`, mimetype: type.split(';')[0] ?? 'image/jpeg', buffer: buf }, alt);
    return (asset as { url?: string }).url ?? null;
  } catch {
    return null;
  }
}

/**
 * Store an image that arrived INSIDE the file (a PDF), not as a URL.
 *
 * The extractor pulls these out page by page; this is what actually puts them
 * in Media and on the product. Before it existed the images were extracted,
 * shown, and then silently dropped at import.
 */
async function importDataUrl(dataUrl: string, alt: string): Promise<string | null> {
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  try {
    const buf = Buffer.from(m[2]!, 'base64');
    if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null;
    const ext = (m[1]!.split('/')[1] ?? 'png').replace('+xml', '');
    const asset = await mediaService.upload(
      { filename: `${slugify(alt) || 'image'}.${ext}`, mimetype: m[1]!, buffer: buf },
      alt,
    );
    return (asset as { url?: string }).url ?? null;
  } catch {
    return null;
  }
}

/** Resolve or create a category from "mens/t-shirts" or "Mens". */
async function categoryIdForPath(path: string): Promise<string | null> {
  const segments = path.split('/').map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return null;
  let parentId: string | null = null;
  let id: string | null = null;
  for (const segment of segments) {
    const slug = slugify(segment);
    if (!slug) return null;
    const existing: { id: string } | null = await db.productCategory.findFirst({ where: { slug, parentId }, select: { id: true } });
    const row: { id: string } = existing ?? (await db.productCategory.create({ data: { name: segment, slug, parentId }, select: { id: true } }));
    id = row.id;
    parentId = row.id;
  }
  return id;
}

async function tagIdsFor(raw: string): Promise<string[]> {
  const names = raw.split(/[,;|]/).map((t) => t.trim()).filter(Boolean);
  const ids: string[] = [];
  for (const name of names) {
    const slug = slugify(name);
    if (!slug) continue;
    const existing = await db.productTag.findUnique({ where: { slug }, select: { id: true } });
    const row = existing ?? (await db.productTag.create({ data: { name, slug }, select: { id: true } }));
    ids.push(row.id);
  }
  return ids;
}

export interface CommitOptions {
  /** One target field per column, same order as the headers. */
  mapping: TargetField[];
  /** Rows WITHOUT the header row. */
  rows: string[][];
  /** Fetch and store remote images. Off makes a large import much faster. */
  withImages?: boolean;
  /**
   * One data URL per row, for images that came out of the file itself.
   * Aligned with `rows`; a null means that row has no image.
   */
  rowImages?: (string | null)[];
  /** What to do when a product with the same slug already exists. */
  onDuplicate?: 'skip' | 'update';
  /** Status for rows whose file does not say. Draft, so nothing goes live unreviewed. */
  defaultStatus?: 'draft' | 'active';
}

export interface CommitResult {
  created: number;
  updated: number;
  skipped: number;
  imagesImported: number;
  errors: { row: number; message: string }[];
}

export async function commit(opts: CommitOptions): Promise<CommitResult> {
  const { mapping, rows } = opts;
  const withImages = opts.withImages ?? true;
  const onDuplicate = opts.onDuplicate ?? 'skip';
  const defaultStatus = opts.defaultStatus ?? 'draft';
  const out: CommitResult = { created: 0, updated: 0, skipped: 0, imagesImported: 0, errors: [] };

  const columnFor = (field: TargetField): number => mapping.indexOf(field);
  const iName = columnFor('name');
  if (iName < 0) throw new Error('No column is mapped to Name — nothing could be identified.');

  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const cell = (field: TargetField): string => {
      const i = columnFor(field);
      return i >= 0 ? (row[i] ?? '').trim() : '';
    };
    const name = cell('name');
    if (!name) { out.skipped += 1; continue; }

    try {
      const slug = slugify(name);
      const existing = await db.product.findUnique({ where: { slug }, select: { id: true } });
      if (existing && onDuplicate === 'skip') { out.skipped += 1; continue; }

      const priceMinor = parseMoneyToMinor(cell('price')) ?? 0;
      const statusRaw = cell('status').toLowerCase();
      const status = statusRaw === 'active' || statusRaw === 'publish' || statusRaw === 'published'
        ? 'active'
        : statusRaw === 'archived'
          ? 'archived'
          : defaultStatus;
      const stock = Number.parseInt(cell('stock'), 10);

      let imageUrl: string | null = null;
      if (withImages) {
        // An image column wins when there is one; otherwise the image lifted
        // out of the file for this row.
        const embedded = opts.rowImages?.[r] ?? null;
        if (cell('image')) imageUrl = await importImage(cell('image'), name);
        else if (embedded) imageUrl = await importDataUrl(embedded, name);
        if (imageUrl) out.imagesImported += 1;
      }

      const categoryId = cell('category') ? await categoryIdForPath(cell('category')) : null;
      const tagIds = cell('tags') ? await tagIdsFor(cell('tags')) : [];

      const core = {
        name,
        description: cell('description') || null,
        status: status as 'draft' | 'active' | 'archived',
        ...(imageUrl ? { image: imageUrl } : {}),
      };
      // `connect` when creating, `set` when updating: on an existing product a
      // re-import should REPLACE its categories and tags with what the file
      // says, not pile a second set on top of the first.
      const linksForCreate = {
        ...(categoryId ? { categories: { connect: [{ id: categoryId }] } } : {}),
        ...(tagIds.length ? { tags: { connect: tagIds.map((id) => ({ id })) } } : {}),
      };
      const linksForUpdate = {
        ...(categoryId ? { categories: { set: [{ id: categoryId }] } } : {}),
        ...(tagIds.length ? { tags: { set: tagIds.map((id) => ({ id })) } } : {}),
      };

      if (existing) {
        await db.product.update({ where: { id: existing.id }, data: { ...core, ...linksForUpdate } });
        out.updated += 1;
      } else {
        await db.product.create({
          data: {
            ...core,
            ...linksForCreate,
            slug,
            variants: {
              create: [{
                price: priceMinor,
                ...(cell('sku') ? { sku: cell('sku') } : {}),
                ...(Number.isFinite(stock) ? { stock } : {}),
              }],
            },
          },
        });
        out.created += 1;
      }
    } catch (e) {
      // One bad row must not abandon the other nine hundred.
      out.errors.push({ row: r + 2, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
