// Catalogue import — the parsing and mapping logic.
//
// These are the parts that corrupt data SILENTLY when they are wrong: a price
// that reads 1.299,00 as 1.29, a description containing a comma that shunts
// every later column one to the left. Nothing here touches the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDelimited,
  suggestMapping,
  parseMoneyToMinor,
  analyze,
  isFetchableUrl,
} from '../dist/counter/catalogImport.js';

test('parseDelimited: quoted fields keep their delimiters and newlines', () => {
  const csv = 'name,description,price\n' +
    '"Yuzu Kit Kat","Sweet, sour, and citrus",3.50\n' +
    '"Ramune","Contains a marble\nin the neck",2.00\n';
  const rows = parseDelimited(csv);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ['Yuzu Kit Kat', 'Sweet, sour, and citrus', '3.50']);
  // The embedded newline must not split the row — this is the failure that
  // shifts every subsequent product's fields by one column.
  assert.equal(rows[2]?.length, 3);
  assert.match(rows[2]?.[1] ?? '', /marble\nin the neck/);
});

test('parseDelimited: escaped quotes survive', () => {
  const rows = parseDelimited('name\n"He said ""hi"""\n');
  assert.equal(rows[1]?.[0], 'He said "hi"');
});

test('parseDelimited: semicolon and tab files are detected, not mangled', () => {
  const semi = parseDelimited('name;price\nMochi;4,50\n');
  assert.deepEqual(semi[1], ['Mochi', '4,50']);
  const tab = parseDelimited('name\tprice\nPocky\t2.10\n');
  assert.deepEqual(tab[1], ['Pocky', '2.10']);
});

test('parseDelimited: a comma-heavy description does not beat the real delimiter', () => {
  // Every line has more commas than semicolons, but only the semicolon count
  // is consistent — the file is semicolon-delimited.
  const rows = parseDelimited('name;description\nA;one, two, three\nB;four, five, six\n');
  assert.equal(rows[1]?.length, 2);
  assert.equal(rows[1]?.[1], 'one, two, three');
});

test('field detection reads the DATA, so the header language stops mattering', () => {
  // This replaced a list of header words that had grown a German, Spanish,
  // French and Italian branch — a losing game, because the next catalogue is
  // in Japanese or its columns are called "Col3". A price is a price because
  // it looks like money.
  assert.deepEqual(
    suggestMapping(['Artikel', 'Preis', 'Beschreibung', 'Kategorie'], [
      ['Yuzu Kit Kat', '€3,50', 'Zitrus weisse Schokolade', 'snacks/japan'],
      ['Ramune', '€2,00', 'Murmel Flasche', 'snacks/japan'],
    ]),
    ['name', 'price', 'description', 'category'],
  );
  assert.deepEqual(
    suggestMapping(['商品名', '価格', 'カテゴリ'], [
      ['抹茶キットカット', '¥980', 'snacks/japan'],
      ['ラムネ', '¥250', 'snacks/japan'],
    ]),
    ['name', 'price', 'category'],
    'a language no word list covers',
  );
});

test('field detection works with useless headers, or none at all', () => {
  assert.deepEqual(
    suggestMapping(['Col1', 'Col2', 'Col3', 'Col4'], [
      ['Yuzu Kit Kat', '$3.50', 'A sweet and sour citrus white chocolate bar from Japan', 'https://cdn.x/y.jpg'],
      ['Ramune', '$2.00', 'A carbonated soda sealed with a glass marble in the neck', 'https://cdn.x/r.jpg'],
    ]),
    ['name', 'price', 'description', 'image'],
  );
  assert.deepEqual(
    suggestMapping(['', '', ''], [['Pocky', '¥980', 'https://cdn.x/p.png'], ['Hi-Chew', '¥750', 'https://cdn.x/h.png']]),
    ['name', 'price', 'image'],
    'no headers whatsoever',
  );
});

test('a count is not a price, even though both are numbers', () => {
  // The distinguishing feature is the currency symbol and the decimal, not
  // the position or the header.
  assert.deepEqual(
    suggestMapping(['A', 'B', 'C'], [['Mochi', '12', '$4.50'], ['Senbei', '300', '$3.25']]),
    ['name', 'stock', 'price'],
  );
});

test('header text still breaks a tie when the data cannot', () => {
  // Two indistinguishable text columns: the header is all there is to go on.
  const m = suggestMapping(['Product', 'Notes'], [['Mochi', 'Soft rice cake'], ['Senbei', 'Rice cracker']]);
  assert.equal(m[0], 'name');
});

test('parseMoneyToMinor: money arrives in every format and must land in cents', () => {
  assert.equal(parseMoneyToMinor('3.50'), 350);
  assert.equal(parseMoneyToMinor('$1,299.00'), 129900, 'thousands separator');
  assert.equal(parseMoneyToMinor('1.299,00'), 129900, 'European decimal comma');
  assert.equal(parseMoneyToMinor('4,50'), 450, 'lone decimal comma');
  assert.equal(parseMoneyToMinor('¥980'), 98000);
  assert.equal(parseMoneyToMinor('12.345'), 1235, 'rounds to the nearest cent, half up');
  assert.equal(parseMoneyToMinor(''), null);
  assert.equal(parseMoneyToMinor('call for pricing'), null, 'no number means no price, not zero');
});

test('analyze: reports headers, a sample and a real row count', () => {
  const csv = 'Product Name,Price\nA,1.00\nB,2.00\nC,3.00\n';
  const a = analyze(csv);
  assert.deepEqual(a.headers, ['Product Name', 'Price']);
  assert.deepEqual(a.suggested, ['name', 'price']);
  assert.equal(a.totalRows, 3, 'the header row is not counted as a product');
  assert.equal(a.sample.length, 3);
});

test('isFetchableUrl: refuses to fetch the private network (SSRF)', () => {
  assert.equal(isFetchableUrl('https://cdn.example.com/a.jpg'), true);
  // These come from an uploaded spreadsheet, so "an admin typed it" is not
  // true — the file can point the server at its own network.
  assert.equal(isFetchableUrl('http://127.0.0.1/a.jpg'), false);
  assert.equal(isFetchableUrl('http://localhost/a.jpg'), false);
  assert.equal(isFetchableUrl('http://169.254.169.254/latest/meta-data/'), false, 'cloud metadata');
  assert.equal(isFetchableUrl('http://10.0.0.5/a.jpg'), false);
  assert.equal(isFetchableUrl('http://192.168.1.10/a.jpg'), false);
  assert.equal(isFetchableUrl('http://172.16.4.4/a.jpg'), false);
  assert.equal(isFetchableUrl('file:///etc/passwd'), false);
  assert.equal(isFetchableUrl('not a url'), false);
});

// ── File formats ───────────────────────────────────────────────────────

test('wordVsColumnThreshold: splits word spaces from column gutters', async () => {
  const { wordVsColumnThreshold } = await import('../dist/counter/catalogFiles.js');
  // Measured off a real 3-column PDF page. The median is 58 and lands inside
  // the LARGE cluster, which merges every column into one — the threshold has
  // to sit in the jump between 7 and 22.
  const real = [7, 7, 7, 7, 22, 36, 58, 65, 65, 65, 79, 86];
  const cut = wordVsColumnThreshold(real);
  assert.ok(cut > 7 && cut < 22, `expected a cut between 7 and 22, got ${cut}`);

  // Evenly spaced SMALL gaps are prose: keep the line whole rather than
  // inventing columns.
  assert.equal(wordVsColumnThreshold([6, 7, 7, 8, 8, 9]), Infinity);

  // Evenly spaced LARGE gaps are a table whose producer emitted each cell as
  // one item (Chrome's print-to-PDF does this) — there are no word gaps to
  // contrast against, so every gap is a column. Measured on a real page.
  const allColumns = wordVsColumnThreshold([14, 22, 29, 46, 59]);
  assert.ok(allColumns < 14, `every gap should split, got ${allColumns}`);
  assert.equal(wordVsColumnThreshold([5]), Infinity, 'one gap cannot define a split');
});

test('xlsx: reads a real workbook, resolving formulas and keeping empty cells in place', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const { extract } = await import('../dist/counter/catalogFiles.js');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Catalogue');
  ws.addRow(['Item Name', 'Unit Price', 'Category']);
  ws.addRow(['Yuzu Kit Kat', 3.5, 'snacks/japan']);
  const r = ws.addRow(['Pocky', null, 'snacks/japan']);
  // A formula cell must arrive as the number a human sees, not "=ROUND(...)".
  r.getCell(2).value = { formula: 'ROUND(2.1,2)', result: 2.1 };
  const buf = Buffer.from(await wb.xlsx.writeBuffer());

  const out = await extract(buf, 'catalogue.xlsx');
  assert.equal(out.kind, 'xlsx');
  assert.deepEqual(out.rows[0], ['Item Name', 'Unit Price', 'Category']);
  assert.deepEqual(out.rows[1], ['Yuzu Kit Kat', '3.5', 'snacks/japan']);
  assert.equal(out.rows[2]?.[1], '2.1', 'formula resolved to its result');
  assert.equal(out.rows[2]?.[2], 'snacks/japan', 'a blank cell must not shift later columns left');
});

test('kindFromFilename: routes by extension and mimetype', async () => {
  const { kindFromFilename } = await import('../dist/counter/catalogFiles.js');
  assert.equal(kindFromFilename('a.pdf'), 'pdf');
  assert.equal(kindFromFilename('a.bin', 'application/pdf'), 'pdf');
  assert.equal(kindFromFilename('a.xlsx'), 'xlsx');
  assert.equal(kindFromFilename('a.csv'), 'delimited');
  assert.equal(kindFromFilename('a.txt'), 'delimited');
});
