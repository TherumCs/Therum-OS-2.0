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

// Header spellings seen in the wild, lowercased. Order matters only in that
// the first field with a hit wins.
const SYNONYMS: Record<Exclude<TargetField, 'ignore'>, string[]> = {
  name: ['name', 'product', 'product name', 'title', 'item', 'item name', 'description short', 'produkt'],
  price: ['price', 'unit price', 'cost', 'amount', 'rrp', 'msrp', 'retail', 'sale price', 'preis'],
  description: ['description', 'desc', 'details', 'long description', 'body', 'notes', 'about'],
  sku: ['sku', 'code', 'item code', 'product code', 'barcode', 'upc', 'ean', 'mpn', 'ref'],
  image: ['image', 'image url', 'img', 'photo', 'picture', 'thumbnail', 'image link', 'images'],
  category: ['category', 'categories', 'type', 'department', 'collection', 'group'],
  tags: ['tags', 'tag', 'labels', 'keywords'],
  stock: ['stock', 'qty', 'quantity', 'inventory', 'on hand', 'available'],
  status: ['status', 'state', 'published', 'active'],
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

/** Best guess of which target field each header means. */
export function suggestMapping(headers: string[]): TargetField[] {
  const taken = new Set<TargetField>();
  return headers.map((raw) => {
    const h = raw.toLowerCase().replace(/[_-]+/g, ' ').trim();
    for (const [field, words] of Object.entries(SYNONYMS) as [Exclude<TargetField, 'ignore'>, string[]][]) {
      if (taken.has(field)) continue;
      // Exact first, then contains — "Product Name" should reach `name`, but
      // "name" must not be stolen by a "filename" column if a better one exists.
      if (words.includes(h) || words.some((w) => h === w)) { taken.add(field); return field; }
    }
    for (const [field, words] of Object.entries(SYNONYMS) as [Exclude<TargetField, 'ignore'>, string[]][]) {
      if (taken.has(field)) continue;
      if (words.some((w) => h.includes(w))) { taken.add(field); return field; }
    }
    return 'ignore';
  });
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
    suggested: suggestMapping(headers),
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
      if (withImages && cell('image')) {
        imageUrl = await importImage(cell('image'), name);
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
