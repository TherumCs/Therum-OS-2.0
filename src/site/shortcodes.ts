// WordPress shortcodes left behind by the port.
//
// The imported pages are WP content, and WP shortcodes are expanded by PHP
// plugins at render time. We do not run those plugins, so anything the theme
// left in the body arrives here as LITERAL TEXT and paints on the page:
//
//   footer signup block -> [contact-form-7 id="970" title="Subscribe"]
//   every blog card     -> [vc_row][vc_column width="1/1"][vc_custom_heading ...
//
// Both were visible on the live site. Stripping them at render — rather than
// editing each stored row — is what keeps them gone when content is re-ported,
// which is how the footer one survived being removed once already.

/**
 * Builder shortcodes that wrap content. The tag goes, whatever sits between
 * the open and close tag stays — that inner text is the actual copy.
 */
const BUILDER_TAGS = [
  'vc_row', 'vc_row_inner', 'vc_column', 'vc_column_inner', 'vc_column_text',
  'vc_custom_heading', 'vc_empty_space', 'vc_single_image', 'vc_btn',
  'vc_separator', 'vc_raw_html', 'vc_raw_js', 'vc_gallery', 'vc_video',
  'vc_tta_section', 'vc_tta_tabs', 'vc_tta_accordion', 'vc_message',
  'uncode_index', 'uncode_block', 'uncode_gallery', 'uncode_share',
  'uncode_related', 'uncode_login', 'uncode_author_box',
  'caption', 'gallery', 'playlist', 'audio', 'video', 'embed', 'et_pb_section',
];

const BUILDER_RE = new RegExp(`\\[\\/?(?:${BUILDER_TAGS.join('|')})\\b[^\\]]*\\]`, 'gi');

/**
 * Anything else shaped like a plugin shortcode.
 *
 * Deliberately narrow: the name must contain a `_` or `-` AND the tag must
 * carry a `key="value"` attribute. That matches `[contact-form-7 id="970"]`
 * and misses ordinary bracketed prose like `[1]`, `[see note]` or `[TODO]`,
 * which a looser pattern would silently eat out of a customer's copy.
 */
const PLUGIN_RE = /\[\/?[a-z][a-z0-9]*[_-][a-z0-9_-]*(?:\s+[a-z_-]+="[^"]*")+\s*\/?\]/gi;

/** The footer signup, which is what `[contact-form-7]` stood in for. */
export const SUBSCRIBE_FORM = `<form class="tsc-sub" data-tsc-subscribe novalidate>
<label class="tsc-sub__label" for="tsc-sub-email">Email address</label>
<div class="tsc-sub__row">
<input class="tsc-sub__input" id="tsc-sub-email" type="email" name="email" required
 autocomplete="email" placeholder="Email address">
<button class="tsc-sub__go" type="submit">Subscribe</button>
</div>
<p class="tsc-sub__note" role="status" aria-live="polite"></p>
</form>`;

/**
 * The submit handler.
 *
 * Inline and self-contained: the ported chrome ships no JS bundle of its own,
 * and the site CSP allows `'unsafe-inline'` for scripts but restricts
 * `connect-src` to `'self'`, so a same-origin POST is the only shape that can
 * work here anyway.
 */
export const SUBSCRIBE_SCRIPT = `
(function(){
  document.querySelectorAll('form[data-tsc-subscribe]').forEach(function(f){
    if (f.__tscSub) return;
    f.__tscSub = true;
    var note = f.querySelector('.tsc-sub__note');
    var go = f.querySelector('.tsc-sub__go');
    var input = f.querySelector('.tsc-sub__input');
    f.addEventListener('submit', function(e){
      e.preventDefault();
      var email = (input.value || '').trim();
      // Validate here as well as on the server: a round trip to be told the
      // address is empty is a worse experience than saying so immediately.
      if (!email || email.indexOf('@') < 1) { note.textContent = 'Enter a valid email address.'; return; }
      go.disabled = true;
      note.textContent = '';
      fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      }).then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ return { ok: r.ok, j: j }; }); })
        .then(function(res){
          if (res.ok && res.j.ok) { f.reset(); note.textContent = 'Thanks — check your inbox for your code.'; }
          else { note.textContent = res.j.error || 'Could not sign you up just now.'; go.disabled = false; }
        })
        .catch(function(){ note.textContent = 'Could not sign you up just now.'; go.disabled = false; });
    });
  });
})();`;

/**
 * Cache-buster for the ported `/wp-content/uploads/` images.
 *
 * Those files are served with `Cache-Control: public, max-age=31536000,
 * immutable`. `immutable` means the browser will NOT revalidate — not on a
 * normal reload, not when the file changes on disk. So any browser that once
 * received a bad response for one of these URLs keeps showing a broken image
 * forever, with no way for the server to correct it.
 *
 * That is exactly what happened: the API was down for ~10 minutes while those
 * files were being rewritten, and every browser that loaded the page in that
 * window pinned the failure. Bam's whole homepage rendered as alt text while
 * the same URLs served perfect bytes to a fresh browser — verified 20 of 20
 * intact and decoding.
 *
 * Changing the URL is the only lever the server has, because `immutable`
 * removed every other one. Bump VERSION to force every client to refetch.
 */
const UPLOAD_VERSION = '2';
const UPLOAD_URL_RE = /(["'(])(\/wp-content\/uploads\/[^"')\s]+?\.(?:png|jpe?g|gif|webp|avif|svg))(["')])/gi;

export function bustUploadUrls(html: string, version = UPLOAD_VERSION): string {
  if (!html || html.indexOf('/wp-content/uploads/') === -1) return html;
  return html.replace(UPLOAD_URL_RE, (m, open, url, close) =>
    (url.includes('?') ? m : `${open}${url}?v=${version}${close}`));
}

/**
 * Replace expandable shortcodes, strip the rest.
 *
 * Order matters: `[contact-form-7 …]` would also match PLUGIN_RE, so it has to
 * become the form before the generic strip runs.
 */
export function cleanShortcodes(html: string): string {
  const busted = bustUploadUrls(html);
  if (!busted || busted.indexOf('[') === -1) return busted;
  return busted
    .replace(/\[contact-form-7\b[^\]]*\]/gi, SUBSCRIBE_FORM)
    .replace(BUILDER_RE, '')
    .replace(PLUGIN_RE, '');
}

