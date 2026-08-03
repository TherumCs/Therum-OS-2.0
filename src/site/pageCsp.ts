/**
 * The Content-Security-Policy every public HTML page is served with.
 *
 * It exists because helmet's global default is `script-src 'self'`, which
 * blocks inline scripts — and every page this app renders ships its behaviour
 * inline: the cart, the quick checkout, the gallery, the countdown on the
 * coming-soon page. A page served WITHOUT this header gets helmet's default
 * and silently loses all of its JavaScript. It still renders, which is what
 * makes the failure hard to spot: the markup is all there, nothing 404s, and
 * nothing works.
 *
 * That is exactly how the coming-soon page shipped with a countdown stuck on
 * "--" and an email form that did nothing — it is served from the maintenance
 * gate in server.ts, the one HTML path that was not setting this.
 *
 * Defined ONCE here because it was previously copy-pasted into two route files
 * and the third path did not know it existed.
 *
 * `'unsafe-inline'` for scripts is a real weakening and worth stating plainly:
 * the alternative is a per-request nonce threaded through every template that
 * emits a <script>, which is the right long-term answer. Until then, note that
 * script-src is still limited to this origin — no CDN, no third party — so an
 * injected <script src> from elsewhere is still refused.
 */
export const PAGE_CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline'; " +
  // Google Fonts serves the stylesheet from googleapis and the font files
  // from gstatic. The reference site's theme asks for Manrope; without these
  // the family resolves to a fallback and every page renders in the wrong
  // typeface. Two named hosts, not a wildcard.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' data: https://fonts.gstatic.com; " +
  'img-src \'self\' data: https:; ' +
  // Hosted product video and posters.
  "media-src 'self' https:; " +
  "connect-src 'self'; " +
  "frame-ancestors 'self'; " +
  "base-uri 'self'";

/**
 * The account page only — the one page that offers social sign-in.
 *
 * Google Identity Services will not work from a first-party-only policy: it
 * loads its own script, opens its consent UI in an iframe, and calls home. So
 * this widens script/frame/connect/style for exactly ONE host, on exactly the
 * page that needs it.
 *
 * Deliberately NOT folded into PAGE_CSP. Every other page — shop, product,
 * checkout, coming-soon — keeps `script-src 'self'`, so the weakening is
 * bounded to the page a shopper signs in on rather than applied to the whole
 * storefront for one button.
 */
const GSI = 'https://accounts.google.com';

export const ACCOUNT_PAGE_CSP =
  "default-src 'self'; " +
  `script-src 'self' 'unsafe-inline' ${GSI}/gsi/client ${GSI}; ` +
  `style-src 'self' 'unsafe-inline' ${GSI}/gsi/style ${GSI}; ` +
  'img-src \'self\' data: https:; ' +
  "media-src 'self' https:; " +
  `connect-src 'self' ${GSI}/gsi/; ` +
  `frame-src ${GSI}/gsi/; ` +
  "frame-ancestors 'self'; " +
  "base-uri 'self'";
