// WooCommerce parity comparator.
//
// Diffs OUR wc/v3 API shape against a REAL WooCommerce store, field-by-field,
// for the surface POD/fulfillment connectors actually use (product, variation,
// category, system_status). Every field a connector validates that we omit —
// or return with the wrong type — reads as a "sync error" on the partner's
// side, so this is the authoritative check that our bridge looks like real
// WooCommerce. Built after chasing those errors one symptom at a time; the
// reference store (a real WooCommerce install) is the source of truth.
//
// Reference auth is OAuth 1.0a (WooCommerce's HTTP scheme) implemented exactly
// as class-wc-rest-authentication.php verifies it. Ours uses plain
// consumer_key/secret query params over HTTPS.
//
// Usage (all via env):
//   REF_URL   real WooCommerce base URL (e.g. http://localhost:8080)
//   REF_CK/REF_CS   a read-scoped WooCommerce API key on the reference store
//   OUR_URL   our base URL (e.g. https://yourstore.example)
//   OUR_CK/OUR_CS   a store credential on our store
//   node tools/woo-parity-compare.mjs   # exit 1 if any shape difference
import crypto from 'node:crypto';

const REF = { url: process.env.REF_URL, ck: process.env.REF_CK, cs: process.env.REF_CS };
const OUR = { url: process.env.OUR_URL, ck: process.env.OUR_CK, cs: process.env.OUR_CS };
for (const [k, v] of Object.entries({ ...REF, ...OUR })) if (!v) { console.error(`missing env for ${k}`); process.exit(2); }

const rfc = (s) => encodeURIComponent(String(s)).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
function signedRef(method, rawUrl) {
  const u = new URL(rawUrl); const base = u.origin + u.pathname; const p = {};
  for (const [k, v] of u.searchParams) p[k] = v;
  p.oauth_consumer_key = REF.ck; p.oauth_nonce = crypto.randomBytes(16).toString('hex');
  p.oauth_signature_method = 'HMAC-SHA256'; p.oauth_timestamp = String(Math.floor(Date.now() / 1000));
  const joined = Object.keys(p).sort().map((k) => rfc(rfc(k) + '=' + rfc(p[k])));
  const sts = method + '&' + rfc(base) + '&' + joined.join('%26');
  p.oauth_signature = crypto.createHmac('sha256', REF.cs + '&').update(sts).digest('base64');
  return base + '?' + Object.keys(p).map((k) => rfc(k) + '=' + rfc(p[k])).join('&');
}
const real = async (path) => { const r = await fetch(signedRef('GET', REF.url + '/wp-json' + path), { signal: AbortSignal.timeout(15000) }); return r.ok ? r.json() : { __err: r.status }; };
const ours = async (path) => { const sep = path.includes('?') ? '&' : '?'; const r = await fetch(`${OUR.url}/wp-json${path}${sep}consumer_key=${OUR.ck}&consumer_secret=${OUR.cs}`, { signal: AbortSignal.timeout(15000) }); return r.ok ? r.json() : { __err: r.status }; };

const typ = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const first = (x) => (Array.isArray(x) ? x[0] : x);
const problems = [];
function diff(realObj, ourObj, label) {
  if (!realObj || realObj.__err) { problems.push(`[${label}] reference fetch error ${realObj?.__err}`); return; }
  if (!ourObj || ourObj.__err) { problems.push(`[${label}] our fetch error ${ourObj?.__err}`); return; }
  for (const k of Object.keys(realObj)) {
    if (!(k in ourObj)) { problems.push(`[${label}] MISSING "${k}" (real type ${typ(realObj[k])})`); continue; }
    const rt = typ(realObj[k]), ot = typ(ourObj[k]);
    if (rt !== ot && rt !== 'null' && ot !== 'null') problems.push(`[${label}] TYPE "${k}": real=${rt} ours=${ot}`);
  }
}

const rp = first(await real('/wc/v3/products?type=variable&per_page=1')) || first(await real('/wc/v3/products?per_page=1'));
const op = first(await ours('/wc/v3/products?per_page=5&type=variable')) || first(await ours('/wc/v3/products?per_page=1'));
diff(rp, op, 'product');
if (rp?.images?.[0] && op?.images?.[0]) diff(rp.images[0], op.images[0], 'product.images[]');
const rv = rp?.id ? first(await real(`/wc/v3/products/${rp.id}/variations?per_page=1`)) : null;
const ov = op?.id ? first(await ours(`/wc/v3/products/${op.id}/variations?per_page=1`)) : null;
diff(rv, ov, 'variation');
diff(first(await real('/wc/v3/products/categories?per_page=1')), first(await ours('/wc/v3/products/categories?per_page=1')), 'category');
diff(await real('/wc/v3/system_status'), await ours('/wc/v3/system_status'), 'system_status');

if (problems.length) { console.error(`woo-parity: ${problems.length} difference(s) from real WooCommerce:`); problems.forEach((p) => console.error('  ' + p)); process.exit(1); }
console.log('woo-parity: our wc/v3 matches real WooCommerce on product, variation, category, system_status.');
