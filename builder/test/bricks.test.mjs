// Round-trip coverage for the Bricks adapter (fromBricks/toBricks) — the load-
// bearing logic for the Unlocked "OS + Bricks" foundation. Previously untested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromBricks, toBricks } from '../src/extensions/bricks/adapter.ts';

const SAMPLE_BRICKS = [
  { id: 'sec1', name: 'section', parent: 0, children: ['head1', 'btn1'], settings: {} },
  { id: 'head1', name: 'heading', parent: 'sec1', children: [], settings: { text: 'Welcome', tag: 'h1' } },
  { id: 'btn1', name: 'button', parent: 'sec1', children: [], settings: { text: 'Shop now', link: { type: 'external', url: '/shop' } } },
];

test('fromBricks: flat array becomes a nested canvas tree, mapping known element names', () => {
  const tree = fromBricks(SAMPLE_BRICKS);
  assert.equal(tree.type, 'section', 'synthetic root wrapper');
  assert.equal(tree.children.length, 1, 'one top-level Bricks element (sec1)');

  const sec = tree.children[0];
  assert.equal(sec.id, 'sec1');
  assert.equal(sec.type, 'section');
  assert.equal(sec.children.length, 2);

  const heading = sec.children.find((c) => c.id === 'head1');
  assert.equal(heading.type, 'heading');
  assert.equal(heading.props.text, 'Welcome');
  assert.equal(heading.props.level, 'h1');

  const button = sec.children.find((c) => c.id === 'btn1');
  assert.equal(button.type, 'button');
  assert.equal(button.props.label, 'Shop now');
  assert.equal(button.props.href, '/shop');
});

test('fromBricks: unknown element names fall back sanely (container if it has children, text otherwise)', () => {
  const withUnknown = [
    { id: 's', name: 'section', parent: 0, children: ['x', 'y'], settings: {} },
    { id: 'x', name: 'some-future-bricks-element', parent: 's', children: ['inner'], settings: {} },
    { id: 'inner', name: 'heading', parent: 'x', children: [], settings: { text: 'Nested' } },
    { id: 'y', name: 'another-unknown-leaf', parent: 's', children: [], settings: {} },
  ];
  const tree = fromBricks(withUnknown);
  const sec = tree.children[0];
  assert.equal(sec.children.find((c) => c.id === 'x').type, 'container', 'unknown WITH children -> container, not dropped');
  assert.equal(sec.children.find((c) => c.id === 'y').type, 'text', 'unknown leaf -> text, not dropped');
});

test('toBricks: canvas tree flattens back to a valid Bricks array with correct parent/children wiring', () => {
  const tree = fromBricks(SAMPLE_BRICKS);
  const flat = toBricks(tree);

  assert.equal(flat.length, 3, 'section + heading + button — the synthetic root itself is not emitted');
  const sec = flat.find((e) => e.id === 'sec1');
  assert.equal(sec.parent, 0, 'top-level element parents to 0, matching Bricks convention');
  assert.deepEqual(new Set(sec.children), new Set(['head1', 'btn1']));

  const head = flat.find((e) => e.id === 'head1');
  assert.equal(head.parent, 'sec1');
  assert.equal(head.name, 'heading');
  assert.equal(head.settings.text, 'Welcome');
  assert.equal(head.settings.tag, 'h1');

  const btn = flat.find((e) => e.id === 'btn1');
  assert.equal(btn.settings.link.url, '/shop', 'button href round-trips into settings.link.url');
});

test('round-trip: Bricks -> canvas -> Bricks preserves the structural shape and edited content', () => {
  const tree = fromBricks(SAMPLE_BRICKS);
  // Simulate an edit in the builder (this is what the Inspector does to props).
  tree.children[0].children.find((c) => c.id === 'head1').props.text = 'Edited in Therum';
  const flat = toBricks(tree);
  const roundTripped = fromBricks(flat);

  assert.equal(roundTripped.children.length, tree.children.length);
  const head = roundTripped.children[0].children.find((c) => c.id === 'head1');
  assert.equal(head.props.text, 'Edited in Therum', 'the edit survives a full Bricks round-trip');
});

test('toBricks: unmapped native-only types (productList) do not crash — TYPE_TO_BRICKS covers every ElementType', () => {
  const tree = {
    id: 'root',
    type: 'section',
    props: {},
    children: [{ id: 'p1', type: 'productList', props: { limit: 6, columns: 3 }, children: [] }],
  };
  const flat = toBricks(tree);
  assert.equal(flat[0].name, 'woocommerce-products');
});
