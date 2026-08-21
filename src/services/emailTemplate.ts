// One branded HTML shell for every email the store sends — receipts, refunds,
// admin alerts, the Friends & Family welcome, shipping, offers, login codes.
//
// Table-based with INLINE styles on purpose: email clients (Gmail, Outlook,
// Apple Mail) strip <style> blocks, ignore flex/grid, and block external
// stylesheets, so anything fancier silently breaks. Max 600px, web-safe font
// stack, a hosted PNG logo (clients do NOT render WebP) with an ALT wordmark
// fallback for the ~40% of opens that block images.
//
// Design language: light ground, near-black ink, near-black square uppercase
// buttons, red only as a rare brand accent, centered copy.
// Every line of copy runs through nw() so a single word is never left alone on
// its last line (no widows — a standing rule).

// ── Tokens ───────────────────────────────────────────────────────────────────
const T = {
  bg: '#fafafa', card: '#ffffff', border: '#e7e7e7', hair: '#efefef',
  ink: '#0a0a0a', body: '#4a4a4a', mute: '#8a8a8a', faint: '#b3b3b3',
  black: '#070707', red: '#e83b3b', thumb: '#f2f2f2',
  font: "-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif",
};
// Absolute logo URL for the email header — mail clients render no relative src.
// Configured per-install via EMAIL_LOGO_URL; otherwise falls back to a
// conventional uploads path on the store's public origin (PUBLIC_ORIGIN).
const LOGO = process.env.EMAIL_LOGO_URL
  || `${(process.env.PUBLIC_ORIGIN ?? '').replace(/\/+$/, '')}/wp-content/uploads/2026/03/full-sig-black.png`;

const esc = (s: string): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// No widows: bind the last word of each line to the one before it with a real
// non-breaking space (U+00A0), so a single word can never wrap alone. The
// email-safe technique — clients ignore CSS text-wrap.
const NBSP = String.fromCharCode(160);
const nw = (html: string): string =>
  String(html).split(/(<br\s*\/?>)/i).map((s) => (/^<br/i.test(s) ? s : s.replace(/ ([^ ]+ *)$/, NBSP + '$1'))).join('');

// ── Components ───────────────────────────────────────────────────────────────
const eyebrow = (t: string, color: string = T.mute): string =>
  `<div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:${color};text-align:center;">${nw(esc(t))}</div>`;
const h1 = (t: string): string =>
  `<h1 style="margin:8px 0 0;font-size:27px;line-height:1.15;font-weight:800;letter-spacing:-.02em;color:${T.ink};text-align:center;">${nw(t)}</h1>`;
const para = (t: string, extra: string = ''): string =>
  `<p style="margin:0 0 15px;font-size:15px;line-height:1.7;color:${T.body};text-align:center;${extra}">${nw(t)}</p>`;
const button = (label: string, url: string): string =>
  `<a href="${esc(url)}" style="display:block;background:${T.black};color:#ffffff;text-decoration:none;text-align:center;padding:17px;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">${esc(label)}</a>`;
const hair = (): string => `<div style="height:1px;background:${T.hair};font-size:0;line-height:0;">&nbsp;</div>`;
const note = (t: string): string => `<p style="margin:0;text-align:center;font-size:12px;color:${T.mute};line-height:1.6;">${nw(t)}</p>`;
const section = (pad: string, html: string): string => `<tr><td style="padding:${pad};">${html}</td></tr>`;

// Product row: thumbnail + name/meta + price. Used where an image is available.
function productRow(it: { img?: string; name: string; meta?: string; value: string; muted?: boolean }): string {
  const c = it.muted ? T.mute : T.ink;
  const thumb = it.img
    ? `<td width="64" style="padding:10px 0;"><img src="${esc(it.img)}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;border-radius:8px;background:${T.thumb};object-fit:cover;border:1px solid ${T.hair};"></td>`
    : '';
  return `<tr>${thumb}<td style="padding:10px ${it.img ? '14px' : '0'};vertical-align:middle;text-align:left;">`
    + `<div style="font-size:14px;font-weight:700;color:${c};line-height:1.35;">${nw(esc(it.name))}</div>`
    + (it.meta ? `<div style="font-size:12px;color:${T.mute};margin-top:3px;">${esc(it.meta)}</div>` : '')
    + `</td><td style="padding:10px 0;text-align:right;vertical-align:middle;font-size:14px;font-weight:700;color:${c};white-space:nowrap;">${esc(it.value)}</td></tr>`;
}

// ── Shell ────────────────────────────────────────────────────────────────────
function shell(inner: string, opts: { preheader?: string; siteName?: string } = {}): string {
  const siteName = opts.siteName || 'Therum OS';
  // Absolute links only — mail clients have no base URL. The store's public
  // origin is configured per-install via PUBLIC_ORIGIN; empty when unset.
  const origin = (process.env.PUBLIC_ORIGIN ?? '').replace(/\/+$/, '');
  const host = origin.replace(/^https?:\/\//, '');
  const footer = `${esc(siteName).toUpperCase()} &nbsp;·&nbsp; <a href="${esc(origin)}" style="color:${T.mute};text-decoration:none;">${esc(host)}</a><br>`
    + `<a href="${esc(origin)}/account" style="color:${T.mute};text-decoration:none;">Your account</a> &nbsp;·&nbsp; <a href="${esc(origin)}/account" style="color:${T.mute};text-decoration:none;">Unsubscribe</a>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>`
    + `<body style="margin:0;padding:0;background:${T.bg};">`
    + `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader || '')}</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${T.bg};"><tr><td align="center" style="padding:28px 12px 40px;">`
    + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${T.card};border:1px solid ${T.border};border-radius:14px;overflow:hidden;font-family:${T.font};">`
    + `<tr><td style="height:3px;background:${T.red};font-size:0;line-height:0;">&nbsp;</td></tr>`
    + `<tr><td align="center" style="padding:34px 24px 30px;"><img src="${LOGO}" alt="${esc(siteName).toUpperCase()}" width="150" style="display:block;width:150px;max-width:56%;height:auto;border:0;"></td></tr>`
    + inner
    + `<tr><td style="padding:26px 36px 30px;">${hair()}<div style="padding-top:18px;text-align:center;font-size:11px;line-height:1.7;color:${T.faint};letter-spacing:.02em;">${footer}</div></td></tr>`
    + `</table></td></tr></table></body></html>`;
}

// ── Order emails (receipt · admin new-order · refund) ────────────────────────
// Unchanged signature so existing callers upgrade to the new design for free.
export interface OrderEmailRow { label: string; value: string; muted?: boolean; img?: string; meta?: string }
export interface OrderEmailOpts {
  heading: string;
  intro: string;
  rows: OrderEmailRow[];
  total: string;
  orderNumber: string;
  siteName: string;
  cta?: { label: string; url: string };
  footnote?: string;
}

export function orderEmailHtml(o: OrderEmailOpts): string {
  const rowsHtml = o.rows.map((r) =>
    r.img
      ? productRow({ img: r.img, name: r.label, meta: r.meta, value: r.value, muted: r.muted })
      : `<tr><td style="padding:7px 0;font-size:14px;color:${r.muted ? T.mute : T.ink};text-align:left;">${nw(esc(r.label))}</td>`
        + `<td style="padding:7px 0;font-size:14px;color:${r.muted ? T.mute : T.ink};text-align:right;white-space:nowrap;">${esc(r.value)}</td></tr>`,
  ).join('');
  const inner =
    section('22px 48px 0', eyebrow('Order ' + o.orderNumber) + h1(o.heading) + para(o.intro, 'margin-top:16px;margin-bottom:0;'))
    + section('22px 48px 4px', `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${T.border};border-radius:12px;"><tr><td style="padding:14px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">`
      + rowsHtml
      + `<tr><td style="padding:12px 0 2px;border-top:1px solid ${T.ink};font-size:15px;font-weight:800;color:${T.ink};text-align:left;">Total</td>`
      + `<td style="padding:12px 0 2px;border-top:1px solid ${T.ink};font-size:15px;font-weight:800;color:${T.ink};text-align:right;">${esc(o.total)}</td></tr>`
      + `</table></td></tr></table>`)
    + (o.cta ? section('20px 48px 0', button(o.cta.label, o.cta.url)) : '')
    + (o.footnote ? section('12px 48px 0', note(esc(o.footnote))) : '');
  return shell(inner, { preheader: o.heading, siteName: o.siteName });
}

// ── Message / letter emails (welcome · password · membership · generic) ──────
export interface MessageEmailOpts {
  eyebrow?: string;
  eyebrowColor?: string;
  heading: string;
  paragraphs: string[]; // each may contain inline HTML (<strong>, <br>, entities)
  cta?: { label: string; url: string };
  ctaNote?: string;
  signoff?: string;
  preheader?: string;
  siteName?: string;
}
export function messageEmailHtml(o: MessageEmailOpts): string {
  const body = o.paragraphs
    .map((t, i) => para(t, i === o.paragraphs.length - 1 && !o.cta && !o.signoff ? 'margin-bottom:0;' : ''))
    .join('');
  const inner =
    section('22px 48px 0', (o.eyebrow ? eyebrow(o.eyebrow, o.eyebrowColor) : '') + h1(o.heading) + `<div style="margin-top:20px;">${body}</div>`)
    + (o.cta ? section('24px 48px 0', button(o.cta.label, o.cta.url)) : '')
    + (o.ctaNote ? section('12px 48px 0', note(o.ctaNote)) : '')
    + (o.signoff ? section('26px 48px 0', para(o.signoff, 'margin-bottom:0;')) : '');
  return shell(inner, { preheader: o.preheader ?? o.heading, siteName: o.siteName });
}

/** The Friends & Family welcome — "Replenish Yourself." */
export function welcomeFriendsFamilyHtml(firstName: string, siteName: string): string {
  const origin = (process.env.PUBLIC_ORIGIN ?? '').replace(/\/+$/, '');
  const store = esc(siteName);
  return messageEmailHtml({
    eyebrow: 'Friends & Family', eyebrowColor: T.red,
    heading: 'Replenish Yourself.',
    paragraphs: [
      esc(firstName) + ',',
      store + ' would like to welcome you to experience our way of giving back to some of our most coveted and important supporters.',
      'Attached to this note is your new account &mdash; yours to shop ' + store + ' moving forward, with every item <strong style="color:' + T.ink + ';">already pre&#8209;discounted</strong> for our Friends &amp; Family. No codes, no waiting for a drop. Your price is the price &mdash; just add to cart and check out.',
      'Click below to set your password &mdash; we&rsquo;ll email <em>you</em> a 6&#8209;digit code to confirm it&rsquo;s you, then you&rsquo;re in.',
    ],
    cta: { label: 'Set up your account', url: `${origin}/account?setup=1` },
    ctaNote: 'or open your account page and choose &ldquo;Forgot password?&rdquo; to set one',
    signoff: 'Welcome to the family.<br><span style="color:' + T.mute + ';">&mdash; ' + store + '</span>',
    preheader: 'Your Friends & Family account is ready.',
    siteName,
  });
}

// ── Shipping / tracking ──────────────────────────────────────────────────────
export interface ShippedEmailOpts {
  heading?: string;
  intro?: string;
  carrier: string;
  tracking: string;
  trackingUrl: string;
  estimate?: string;
  items?: { img?: string; name: string; meta?: string; value: string }[];
  siteName?: string;
}
export function shippedEmailHtml(o: ShippedEmailOpts): string {
  const stops = [
    { label: 'Ordered', dot: T.ink }, { label: 'Shipped', dot: T.red }, { label: 'Delivered', dot: '#ffffff' },
  ];
  const track = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${T.border};border-radius:12px;background:#fbfbfb;"><tr><td style="padding:20px;">`
    + `<div style="font-size:11px;font-weight:700;letter-spacing:.12em;color:${T.mute};text-transform:uppercase;text-align:center;">Carrier &amp; tracking</div>`
    + `<div style="font-size:16px;font-weight:800;color:${T.ink};margin-top:6px;text-align:center;">${esc(o.carrier)} &nbsp;·&nbsp; ${esc(o.tracking)}</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;"><tr>`
    + stops.map((s, i) => {
      const cell = `<td style="text-align:center;"><div style="width:14px;height:14px;border-radius:50%;background:${s.dot};${s.dot === '#ffffff' ? `border:2px solid ${T.hair};` : ''}margin:0 auto;"></div><div style="font-size:10px;color:${s.dot === '#ffffff' ? T.faint : T.ink};margin-top:6px;font-weight:700;">${s.label}</div></td>`;
      const bar = i < stops.length - 1 ? `<td style="height:2px;background:${i === 0 ? T.ink : T.hair};"></td>` : '';
      return cell + bar;
    }).join('')
    + `</tr></table>`
    + (o.estimate ? `<div style="font-size:12px;color:${T.mute};margin-top:16px;text-align:center;">${nw(esc(o.estimate))}</div>` : '')
    + `</td></tr></table>`;
  const itemsHtml = o.items?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${o.items.map((it) => productRow({ ...it })).join('')}</table>`
    : '';
  const inner =
    section('22px 48px 0', eyebrow('On the way', T.red) + h1(o.heading || 'Your order shipped.') + para(o.intro || 'Good news &mdash; your order is on its way. Follow it below.', 'margin-top:16px;margin-bottom:0;'))
    + section('22px 48px 4px', track)
    + (itemsHtml ? section('14px 48px 4px', itemsHtml) : '')
    + section('16px 48px 0', button('Track package', o.trackingUrl));
  return shell(inner, { preheader: `${o.carrier} · ${o.tracking}`, siteName: o.siteName });
}

// ── Personal / offer ─────────────────────────────────────────────────────────
export interface OfferEmailOpts {
  heroImg?: string;
  eyebrow?: string;
  heading: string;
  body: string;
  productName?: string;
  price?: string;
  wasPrice?: string;
  badge?: string;
  cta: { label: string; url: string };
  siteName?: string;
}
export function offerEmailHtml(o: OfferEmailOpts): string {
  const hero = o.heroImg
    ? `<tr><td style="padding:20px 0 0;"><img src="${esc(o.heroImg)}" alt="" width="600" height="300" style="display:block;width:100%;height:300px;object-fit:cover;background:${T.thumb};"></td></tr>`
    : '';
  const priceLine = o.price
    ? `<div style="margin-top:6px;text-align:center;"><span style="font-size:22px;font-weight:800;color:${T.ink};">${esc(o.price)}</span>`
      + (o.wasPrice ? ` &nbsp;<span style="font-size:14px;color:${T.faint};text-decoration:line-through;">${esc(o.wasPrice)}</span>` : '')
      + (o.badge ? ` &nbsp;<span style="font-size:11px;font-weight:700;letter-spacing:.1em;color:${T.red};text-transform:uppercase;">${esc(o.badge)}</span>` : '')
      + `</div>`
    : '';
  const inner =
    hero
    + section('24px 48px 0', eyebrow(o.eyebrow || 'Just for you', T.red) + h1(o.heading) + para(o.body, 'margin-top:16px;margin-bottom:' + (o.productName ? '18px;' : '0;'))
      + (o.productName ? `<div style="font-size:14px;font-weight:700;color:${T.ink};text-align:center;">${nw(esc(o.productName))}</div>` : '')
      + priceLine)
    + section('22px 48px 0', button(o.cta.label, o.cta.url));
  return shell(inner, { preheader: o.heading, siteName: o.siteName });
}

// ── Login code / verification ────────────────────────────────────────────────
export interface CodeEmailOpts {
  code: string;
  heading?: string;
  intro?: string;
  siteName?: string;
}
export function codeEmailHtml(o: CodeEmailOpts): string {
  const inner =
    section('22px 48px 0', eyebrow('Sign in') + h1(o.heading || 'Your login code.') + para(o.intro || 'Enter this code to sign in to your account. It expires in 10 minutes.', 'margin-top:16px;margin-bottom:0;'))
    + section('22px 48px 4px', `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${T.border};border-radius:12px;background:#fbfbfb;"><tr><td align="center" style="padding:26px;"><div style="font-size:38px;font-weight:800;letter-spacing:.28em;color:${T.ink};font-family:'SFMono-Regular',Menlo,Consolas,monospace;">${esc(o.code)}</div></td></tr></table>`)
    + section('16px 48px 0', note('Didn&rsquo;t request this? You can safely ignore this email.'));
  return shell(inner, { preheader: 'Your login code.', siteName: o.siteName });
}
