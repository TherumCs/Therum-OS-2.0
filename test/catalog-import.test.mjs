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

test('suggestMapping: recognises the names real exports use', () => {
  const m = suggestMapping(['Product Name', 'Unit Price', 'Long Description', 'Image URL', 'SKU', 'Nonsense']);
  assert.equal(m[0], 'name');
  assert.equal(m[1], 'price');
  assert.equal(m[2], 'description');
  assert.equal(m[3], 'image');
  assert.equal(m[4], 'sku');
  assert.equal(m[5], 'ignore', 'an unrecognised column is skipped, not guessed at');
});

test('suggestMapping: never assigns the same field to two columns', () => {
  const m = suggestMapping(['name', 'title', 'item']);
  assert.equal(m.filter((f) => f === 'name').length, 1);
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
