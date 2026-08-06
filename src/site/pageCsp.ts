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
/**
 * Payment SDK hosts.
 *
 * WITHOUT THESE THE ENTIRE PAYMENT LAYER IS DEAD. A gateway's card field is
 * its own script and its own iframe — that is what keeps raw card numbers out
 * of this application and out of PCI scope — so a first-party-only policy
 * refuses the script, the field never mounts, no wallet button ever renders,
 * and the address autocomplete never loads. Nothing 404s and nothing throws
 * above the catch: the card simply offers no way to pay, which is the hardest
 * kind of failure to spot from the outside.
 *
 * Named hosts, never wildcards. `connect-src` is the gateway's own API, and
 * `frame-src` is required because Stripe Elements and Square's card field are
 * cross-origin iframes.
 */
const STRIPE = ['https://js.stripe.com', 'https://api.stripe.com', 'https://hooks.stripe.com'];
const SQUARE = ['https://web.squarecdn.com', 'https://sandbox.web.squarecdn.com',
  'https://connect.squareup.com', 'https://connect.squareupsandbox.com'];
const PAYPAL = ['https://www.paypal.com', 'https://www.paypalobjects.com'];
const PAY_SCRIPT = [STRIPE[0], SQUARE[0], SQUARE[1], PAYPAL[0], PAYPAL[1]].join(' ');
// The post-office ZIP lookup that fills city and state, so a shopper types
// five digits instead of three fields. Read-only, no key, no personal data
// leaves the page — only the post code goes out.
const ZIP_LOOKUP = 'https://api.zippopotam.us';
const PAY_CONNECT = [STRIPE[1], SQUARE[2], SQUARE[3], PAYPAL[0], ZIP_LOOKUP].join(' ');
const PAY_FRAME = [STRIPE[0], STRIPE[2], SQUARE[0], SQUARE[1], PAYPAL[0]].join(' ');

export const PAGE_CSP =
  "default-src 'self'; " +
  `script-src 'self' 'unsafe-inline' ${PAY_SCRIPT}; ` +
  // Google Fonts serves the stylesheet from googleapis and the font files
  // from gstatic. The reference site's theme asks for Manrope; without these
  // the family resolves to a fallback and every page renders in the wrong
  // typeface. Two named hosts, not a wildcard.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' data: https://fonts.gstatic.com; " +
  'img-src \'self\' data: https:; ' +
  // Hosted product video and posters.
  "media-src 'self' https:; " +
  `connect-src 'self' ${PAY_CONNECT}; ` +
  // Apple Pay and Google Pay present their sheets from the gateway's frame.
  `frame-src 'self' ${PAY_FRAME}; ` +
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

/**
 * DERIVED from PAGE_CSP, not written out again.
 *
 * It used to be a second hand-maintained list, and it drifted: the storefront
 * gained Google Fonts and three payment SDKs while this one kept neither. The
 * account page therefore rendered in a fallback typeface and — measured in the
 * browser console — refused the font stylesheet outright:
 *
 *   Loading the stylesheet 'https://fonts.googleapis.com/...' violates the
 *   following Content Security Policy directive: "style-src 'self' ..."
 *
 * Extending the shared policy means the next host added for the storefront is
 * automatically allowed here too, instead of breaking one page quietly.
 */
export const ACCOUNT_PAGE_CSP = PAGE_CSP
  .replace("script-src 'self' 'unsafe-inline'", `script-src 'self' 'unsafe-inline' ${GSI}/gsi/client ${GSI}`)
  .replace("style-src 'self' 'unsafe-inline'", `style-src 'self' 'unsafe-inline' ${GSI}/gsi/style ${GSI}`)
  .replace("connect-src 'self'", `connect-src 'self' ${GSI}/gsi/ ${GSI}`)
  .replace("frame-src 'self'", `frame-src 'self' ${GSI}/gsi/ ${GSI}`);
