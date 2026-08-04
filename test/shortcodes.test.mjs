import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanShortcodes, SUBSCRIBE_FORM } from '../dist/site/shortcodes.js';

// These two strings are copied from the LIVE page, not invented: the first was
// painting in the footer, the second in every blog card on the home page.

test('the footer contact-form-7 shortcode becomes a real form', () => {
  const out = cleanShortcodes('<div>[contact-form-7 id="970" title="Subscribe"]</div>');
  assert.ok(!out.includes('contact-form-7'), 'shortcode text survived');
  assert.ok(out.includes(SUBSCRIBE_FORM), 'no subscribe form rendered');
});

test('WPBakery shortcodes are stripped but their copy is kept', () => {
  const src = '[vc_row][vc_column width="1/1"][vc_custom_heading text_color="color-jevc" '
    + 'heading_semantic="h1"]The City Series[/vc_custom_heading][vc_empty_space][/vc_column][/vc_row]';
  const out = cleanShortcodes(src);
  assert.ok(!out.includes('['), `shortcode residue left: ${out}`);
  assert.equal(out.trim(), 'The City Series');
});

test('ordinary bracketed prose is left alone', () => {
  // The strip has to be narrow. A looser pattern eats real copy, which is a
  // worse bug than the one it fixes because nobody notices it.
  for (const keep of ['See note [1] below.', 'Size [S] and [M] in stock', 'TODO [check this]']) {
    assert.equal(cleanShortcodes(keep), keep);
  }
});

test('content with no brackets is returned untouched', () => {
  const html = '<div class="c-post">Nothing to do here</div>';
  assert.equal(cleanShortcodes(html), html);
});

test('ported upload URLs get a cache-busting version', () => {
  // immutable + 1 year means a browser that cached a failure never recovers.
  // Changing the URL is the only lever left.
  const out = cleanShortcodes('<img src="/wp-content/uploads/2026/03/mens.webp" alt="mens">');
  assert.match(out, /\/wp-content\/uploads\/2026\/03\/mens\.webp\?v=\d+/);
});

test('cache-busting also covers CSS url() and leaves other paths alone', () => {
  assert.match(cleanShortcodes('a{background:url(/wp-content/uploads/x/y.jpg)}'), /y\.jpg\?v=\d+/);
  const api = '<img src="/api/uploads/abc-def.png">';
  assert.equal(cleanShortcodes(api), api);
});

test('a URL that already has a query is not double-stamped', () => {
  const src = '<img src="/wp-content/uploads/a.png?foo=1">';
  assert.equal(cleanShortcodes(src), src);
});
