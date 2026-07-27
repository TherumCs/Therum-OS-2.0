import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { db } from '../../lib/db.js';
import { capabilityService } from '../../services/capability.service.js';
import { layout, closedPage, esc, money } from '../../site/storefrontHtml.js';

// Counter C4 — the five public storefront surfaces, server-rendered from the
// same Fastify process as the API (same origin, so the client runtime's
// fetch('/api/…') needs no CORS). Catalog reads go straight to the DB with
// status:'active' pinned — the storefront can never leak drafts. Cart state
// stays client-fetched (the cart token lives in localStorage, never in a URL
// — C2 audit M-3 applies to pages too).

// Helmet's default CSP (script-src 'self') would strip the storefront's
// inline runtime; these pages carry their own explicit policy instead —
// still same-origin-only for fetch/img, inline allowed for the page's own
// script+style, nothing external loadable.
// img/media allow https: — product galleries reference media-library or CDN
// URLs, and hover-preview videos stream from wherever the merchant hosts.
const PAGE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' https:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'";

const html = (reply: { header: (k: string, v: string) => unknown; type: (t: string) => { send: (b: string) => void } }, body: string): void => {
  reply.header('content-security-policy', PAGE_CSP);
  reply.type('text/html; charset=utf-8').send(body);
};

// Normalize a product's media into one ordered list. type is explicit or
// inferred from the extension; a video's card-still is its poster (or the
// product's primary image as fallback).
export interface GalleryItem {
  url: string;
  alt: string;
  type: 'image' | 'video';
  poster: string | null;
}

function normalizeGallery(p: { name: string; image: string | null; images: unknown }): GalleryItem[] {
  const raw = [
    ...(p.image ? [{ url: p.image, alt: p.name }] : []),
    ...((Array.isArray(p.images) ? p.images : []) as { url?: string; alt?: string; type?: string; poster?: string }[]),
  ];
  return raw
    .filter((i): i is { url: string; alt?: string; type?: string; poster?: string } => typeof i.url === 'string' && i.url.length > 0)
    .map((i) => ({
      url: i.url,
      alt: i.alt ?? p.name,
      type: i.type === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(i.url) ? 'video' as const : 'image' as const,
      poster: i.poster ?? null,
    }));
}

async function commerceOn(): Promise<boolean> {
  return capabilityService.isEnabled('commerce');
}

export async function storefrontRoutes(app: FastifyInstance): Promise<void> {
  // ── /shop — catalog grid with search + taxonomy/attribute filters ──
  // Filters ride the query string (?q=&category=&tag=&color=&size=), so
  // every filtered view is a shareable, crawlable URL (Woo parity).
  app.get('/shop', async (req, reply) => {
    if (!(await commerceOn())) return html(reply, closedPage());
    const query = req.query as { q?: string; category?: string; tag?: string; color?: string; size?: string };
    const q = (query.q ?? '').trim().slice(0, 100);
    const category = (query.category ?? '').trim().slice(0, 80);
    const tag = (query.tag ?? '').trim().slice(0, 80);
    const color = (query.color ?? '').trim().slice(0, 40);
    const size = (query.size ?? '').trim().slice(0, 40);

    const products = await db.product.findMany({
      where: {
        status: 'active',
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] } : {}),
        ...(category ? { categories: { some: { slug: category } } } : {}),
        ...(tag ? { tags: { some: { slug: tag } } } : {}),
        ...(color ? { variants: { some: { color: { equals: color, mode: 'insensitive' } } } } : {}),
        ...(size ? { variants: { some: { size: { equals: size, mode: 'insensitive' } } } } : {}),
      },
      include: { vendor: { select: { name: true } }, variants: true, categories: { select: { name: true, slug: true } } },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });

    // Filter rails: categories/tags with live products; colors/sizes from
    // active variants (derived attributes — the Woo attribute-filter role).
    const [cats, tags, variantAttrs] = await Promise.all([
      db.productCategory.findMany({ where: { products: { some: { status: 'active' } } }, select: { name: true, slug: true }, orderBy: { name: 'asc' } }),
      db.productTag.findMany({ where: { products: { some: { status: 'active' } } }, select: { name: true, slug: true }, orderBy: { name: 'asc' } }),
      db.productVariant.findMany({ where: { product: { status: 'active' } }, select: { color: true, size: true } }),
    ]);
    const colors = [...new Set(variantAttrs.map((v) => v.color).filter((c): c is string => !!c))].sort();
    const sizes = [...new Set(variantAttrs.map((v) => v.size).filter((s): s is string => !!s))].sort();

    const qs = (over: Record<string, string>): string => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries({ q, category, tag, color, size, ...over })) if (v) params.set(k, v);
      const s = params.toString();
      return s ? `/shop?${s}` : '/shop';
    };
    const chip = (label: string, href: string, active: boolean): string =>
      `<a class="filter-chip${active ? ' active' : ''}" href="${esc(href)}">${esc(label)}</a>`;

    const rails = `
      ${cats.length ? `<div class="filter-row"><span class="filter-label">Category</span>${cats.map((c) => chip(c.name, qs({ category: category === c.slug ? '' : c.slug }), category === c.slug)).join('')}</div>` : ''}
      ${tags.length ? `<div class="filter-row"><span class="filter-label">Tags</span>${tags.map((t) => chip(t.name, qs({ tag: tag === t.slug ? '' : t.slug }), tag === t.slug)).join('')}</div>` : ''}
      ${colors.length > 1 ? `<div class="filter-row"><span class="filter-label">Color</span>${colors.map((c) => chip(c, qs({ color: color.toLowerCase() === c.toLowerCase() ? '' : c }), color.toLowerCase() === c.toLowerCase())).join('')}</div>` : ''}
      ${sizes.length > 1 ? `<div class="filter-row"><span class="filter-label">Size</span>${sizes.map((s) => chip(s, qs({ size: size.toLowerCase() === s.toLowerCase() ? '' : s }), size.toLowerCase() === s.toLowerCase())).join('')}</div>` : ''}`;

    const cards = products.map((p) => {
      const prices = p.variants.map((v) => v.price);
      const from = prices.length ? Math.min(...prices) : 0;
      const range = prices.length && Math.min(...prices) !== Math.max(...prices);
      const gallery = normalizeGallery(p);
      const stills = gallery.filter((g) => g.type === 'image');
      const video = gallery.find((g) => g.type === 'video') ?? null;
      const cardStill = stills[0]?.url ?? video?.poster ?? null;

      // Media block: primary still + (hidden) hover video + arrows/dots when
      // there's more than one still. The runtime wires hover-to-play on
      // pointer devices; arrows work by tap everywhere (the mobile story).
      let media: string;
      if (!cardStill && !video) {
        media = `<div class="thumb">${esc(p.name.slice(0, 2))}</div>`;
      } else {
        const arrows = stills.length > 1
          ? `<button class="card-nav prev" data-dir="-1" aria-label="Previous image">‹</button>
             <button class="card-nav next" data-dir="1" aria-label="Next image">›</button>
             <div class="card-dots">${stills.map((_, i) => `<span class="dot${i === 0 ? ' on' : ''}"></span>`).join('')}</div>`
          : '';
        media = `
        <div class="thumb card-media" data-stills='${esc(JSON.stringify(stills.map((s) => s.url)))}'>
          ${cardStill ? `<img class="card-still" src="${esc(cardStill)}" alt="${esc(p.name)}" loading="lazy">` : ''}
          ${video ? `<video class="card-video" muted loop playsinline preload="none" src="${esc(video.url)}"${video.poster ? ` poster="${esc(video.poster)}"` : ''}></video>` : ''}
          ${arrows}
        </div>`;
      }

      return `
      <a class="card" href="/product/${esc(p.slug)}">
        ${media}
        <div class="body">
          <div class="name">${esc(p.name)}</div>
          ${p.categories.length ? `<div class="vendor">${p.categories.map((c) => esc(c.name)).join(' · ')}</div>` : p.vendor ? `<div class="vendor">${esc(p.vendor.name)}</div>` : ''}
          <div class="price">${range ? 'From ' : ''}${money(from)}</div>
        </div>
      </a>`;
    }).join('');

    html(reply, layout('Shop — Therum Store', `
      <div class="shop-head">
        <div>
          <h1 class="page-title">Shop</h1>
          <p class="page-sub">${products.length} product${products.length === 1 ? '' : 's'}${q ? ` for “${esc(q)}”` : ''}</p>
        </div>
        <form class="shop-search" action="/shop" method="get">
          <input type="search" name="q" placeholder="Search products…" value="${esc(q)}" aria-label="Search products">
          ${category ? `<input type="hidden" name="category" value="${esc(category)}">` : ''}
          ${tag ? `<input type="hidden" name="tag" value="${esc(tag)}">` : ''}
          <button class="btn sm" type="submit">Search</button>
        </form>
      </div>
      ${rails}
      ${products.length ? `<div class="grid">${cards}</div>` : `<div class="empty-state"><div class="big">🛍️</div><p>No products${q || category || tag || color || size ? ' match those filters' : ' here yet'}.</p>${q || category || tag || color || size ? '<p style="margin-top:12px"><a class="btn ghost sm" href="/shop">Clear filters</a></p>' : ''}</div>`}
    `));
  });

  // ── /product/:slug — detail + variant picker ──
  app.get('/product/:slug', async (req, reply) => {
    if (!(await commerceOn())) return html(reply, closedPage());
    const { slug } = req.params as { slug: string };
    const p = await db.product.findUnique({
      where: { slug },
      include: {
        vendor: { select: { name: true } },
        variants: { orderBy: { price: 'asc' } },
        categories: { select: { name: true, slug: true } },
        tags: { select: { name: true, slug: true } },
      },
    });
    if (!p || p.status !== 'active') {
      reply.status(404);
      return html(reply, layout('Not found', '<div class="empty-state"><div class="big">🔍</div><h1 class="page-title">Product not found</h1><p class="page-sub"><a href="/shop" style="color:var(--ac-btn)">Back to the shop</a></p></div>'));
    }

    const variants = p.variants.map((v) => ({
      id: v.id,
      label: [v.color, v.size].filter(Boolean).join(' / ') || v.sku || 'Default',
      price: v.price,
      available: v.inventory - v.reserved,
    }));

    const picker = variants.map((v, i) => `
      <button type="button" data-variant="${esc(v.id)}" data-price="${v.price}" ${v.available <= 0 ? 'disabled' : ''} class="${i === 0 && v.available > 0 ? 'sel' : ''}">${esc(v.label)}</button>`).join('');

    const firstAvailable = variants.find((v) => v.available > 0);

    // Gallery: stills + video, one strip. Selecting a video thumb plays it
    // (muted, controls) in the main slot; stills swap the image back in.
    const gallery = normalizeGallery(p);
    const galleryHtml = gallery.length
      ? `<div class="gallery">
          <div class="thumb gallery-main" id="gallery-main">${gallery[0]?.type === 'video'
            ? `<video controls muted playsinline src="${esc(gallery[0].url)}"${gallery[0].poster ? ` poster="${esc(gallery[0].poster)}"` : ''}></video>`
            : `<img src="${esc(gallery[0]?.url ?? '')}" alt="${esc(gallery[0]?.alt ?? p.name)}">`}</div>
          ${gallery.length > 1 ? `<div class="gallery-strip">${gallery.map((g, i) => `
            <button type="button" class="gallery-thumb${i === 0 ? ' sel' : ''}" data-src="${esc(g.url)}" data-type="${g.type}"${g.poster ? ` data-poster="${esc(g.poster)}"` : ''} aria-label="${esc(g.type === 'video' ? 'Play video' : g.alt)}">
              <img src="${esc(g.type === 'video' ? (g.poster ?? gallery.find((x) => x.type === 'image')?.url ?? '') : g.url)}" alt="${esc(g.alt)}" loading="lazy">
              ${g.type === 'video' ? '<span class="play-badge">▶</span>' : ''}
            </button>`).join('')}</div>` : ''}
        </div>`
      : `<div class="thumb">${esc(p.name)}</div>`;

    const taxonomyPills = [
      ...p.categories.map((c) => `<a class="pill" href="/shop?category=${esc(c.slug)}">${esc(c.name)}</a>`),
      ...p.tags.map((t) => `<a class="pill" href="/shop?tag=${esc(t.slug)}">#${esc(t.name)}</a>`),
    ].join(' ');

    html(reply, layout(`${p.name} — Therum Store`, `
      <div class="product-hero">
        ${galleryHtml}
        <div>
          ${p.vendor ? `<span class="pill">${esc(p.vendor.name)}</span>` : ''}
          <h1 class="page-title" style="margin-top:10px">${esc(p.name)}</h1>
          <div class="price-big" id="price">${money(firstAvailable?.price ?? variants[0]?.price ?? 0)}</div>
          <div class="stock-note" id="stock">${firstAvailable ? `${firstAvailable.available} in stock` : 'Out of stock'}</div>
          ${variants.length > 1 ? `<label>Options</label><div class="variant-picker" id="picker">${picker}</div>` : ''}
          <button class="btn" id="add" ${firstAvailable ? '' : 'disabled'}>Add to cart</button>
          ${p.description ? `<div class="product-desc">${esc(p.description).replace(/\n/g, '<br>')}</div>` : ''}
          ${taxonomyPills ? `<div class="taxonomy-row">${taxonomyPills}</div>` : ''}
        </div>
      </div>`, `
document.querySelectorAll('.gallery-thumb').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.gallery-thumb').forEach(x=>x.classList.remove('sel'));
  b.classList.add('sel');
  const main=document.getElementById('gallery-main');
  if(b.dataset.type==='video'){
    main.innerHTML='<video controls muted playsinline autoplay src="'+b.dataset.src+'"'+(b.dataset.poster?' poster="'+b.dataset.poster+'"':'')+'></video>';
  }else{
    main.innerHTML='<img src="'+b.dataset.src+'" alt="">';
  }
}));
const VARIANTS=${JSON.stringify(variants)};
let sel=VARIANTS.find(v=>v.available>0)||VARIANTS[0];
const picker=document.getElementById('picker');
if(picker)picker.addEventListener('click',(e)=>{
  const b=e.target.closest('button[data-variant]');if(!b||b.disabled)return;
  picker.querySelectorAll('button').forEach(x=>x.classList.remove('sel'));
  b.classList.add('sel');
  sel=VARIANTS.find(v=>v.id===b.dataset.variant);
  document.getElementById('price').textContent=(sel.price/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
  document.getElementById('stock').textContent=sel.available>0?sel.available+' in stock':'Out of stock';
  document.getElementById('add').disabled=sel.available<=0;
});
document.getElementById('add').addEventListener('click',(e)=>{if(sel)addToCart(sel.id,1,e.target)});
`));
  });

  // ── /cart — session review, coupon, line edits (all client-rendered from
  //     /api/cart since the token is client-held) ──
  app.get('/cart', async (_req, reply) => {
    if (!(await commerceOn())) return html(reply, closedPage());
    html(reply, layout('Cart — Therum Store', `
      <h1 class="page-title">Cart</h1>
      <div id="cart-root"><p class="page-sub">Loading…</p></div>`, `
async function renderCart(){
  const root=document.getElementById('cart-root');
  if(!tok()){root.innerHTML='<div class="empty-state"><div class="big">🛒</div><p>Your cart is empty.</p><p style="margin-top:14px"><a class="btn" href="/shop">Browse the shop</a></p></div>';return}
  let c;
  try{c=await api('/cart',{useToken:true})}
  catch(e){setTok(null);root.innerHTML='<div class="empty-state"><div class="big">🛒</div><p>Your cart is empty.</p><p style="margin-top:14px"><a class="btn" href="/shop">Browse the shop</a></p></div>';return}
  const t=c.totals;
  if(!t.lines.length){root.innerHTML='<div class="empty-state"><div class="big">🛒</div><p>Your cart is empty.</p><p style="margin-top:14px"><a class="btn" href="/shop">Browse the shop</a></p></div>';return}
  const fmt=(m)=>(m/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
  const rows=t.lines.map(l=>\`
    <tr>
      <td><strong>\${l.productName}</strong>\${l.sku?' <span style="color:var(--tx3)">('+l.sku+')</span>':''}</td>
      <td><span class="qty">
        <button data-dec="\${l.variantId}" aria-label="Decrease">−</button>
        <span>\${l.quantity}</span>
        <button data-inc="\${l.variantId}" data-q="\${l.quantity}" aria-label="Increase">+</button>
      </span></td>
      <td class="num">\${fmt(l.unitPrice)}</td>
      <td class="num"><strong>\${fmt(l.lineTotal)}</strong></td>
    </tr>\`).join('');
  root.innerHTML=\`
  <div class="split">
    <div class="panel">
      <table class="lines">
        <thead><tr><th>Item</th><th>Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead>
        <tbody>\${rows}</tbody>
      </table>
    </div>
    <div class="panel">
      <div style="margin-bottom:16px">
        <label for="coupon">Coupon</label>
        <div style="display:flex;gap:8px">
          <input type="text" id="coupon" placeholder="Code" value="\${t.coupon?t.coupon.code:''}">
          <button class="btn sm ghost" id="apply-coupon">\${t.coupon?'Update':'Apply'}</button>
        </div>
        \${t.coupon?'<p class="notice ok">Coupon '+t.coupon.code+' — −'+fmt(t.coupon.amount)+' <a href="#" id="rm-coupon" style="color:var(--err);margin-left:6px">remove</a></p>':''}
        <div id="coupon-msg"></div>
      </div>
      <div class="totals">
        <div class="row muted"><span>Subtotal</span><span class="num">\${fmt(t.subtotal)}</span></div>
        \${t.coupon?'<div class="row muted"><span>Coupon</span><span class="num">−'+fmt(t.coupon.amount)+'</span></div>':''}
        <div class="row grand"><span>Total</span><span class="num">\${fmt(t.total)}</span></div>
      </div>
      <a class="btn" href="/checkout" style="width:100%;margin-top:18px">Checkout</a>
    </div>
  </div>\`;
  root.querySelectorAll('[data-inc]').forEach(b=>b.addEventListener('click',async()=>{
    await api('/cart/items/'+b.dataset.inc,{method:'PATCH',body:JSON.stringify({cartToken:tok(),quantity:Number(b.dataset.q)+1})}).catch(e=>alert(e.message));
    renderCart();refreshCount();
  }));
  root.querySelectorAll('[data-dec]').forEach(b=>b.addEventListener('click',async()=>{
    const l=t.lines.find(x=>x.variantId===b.dataset.dec);
    await api('/cart/items/'+b.dataset.dec,{method:'PATCH',body:JSON.stringify({cartToken:tok(),quantity:l.quantity-1})}).catch(e=>alert(e.message));
    renderCart();refreshCount();
  }));
  const ap=document.getElementById('apply-coupon');
  if(ap)ap.addEventListener('click',async()=>{
    const code=document.getElementById('coupon').value.trim();if(!code)return;
    try{await api('/cart/coupon',{method:'POST',body:JSON.stringify({cartToken:tok(),code})});renderCart()}
    catch(e){document.getElementById('coupon-msg').innerHTML='<p class="notice err">'+e.message+'</p>'}
  });
  const rm=document.getElementById('rm-coupon');
  if(rm)rm.addEventListener('click',async(e)=>{e.preventDefault();await api('/cart/coupon',{method:'DELETE',useToken:true});renderCart()});
}
document.addEventListener('DOMContentLoaded',renderCart);
`));
  });

  // ── /checkout — contact, gateway pick, place order ──
  app.get('/checkout', async (_req, reply) => {
    if (!(await commerceOn())) return html(reply, closedPage());
    html(reply, layout('Checkout — Therum Store', `
      <h1 class="page-title">Checkout</h1>
      <div id="co-root"><p class="page-sub">Loading…</p></div>`, `
// The tabbed method strip — ported from 1.x checkout-experience.html.
// Groups render as pills (with hover previews); each panel lists its
// methods. A method with no connected provider renders disabled with a
// "Setup required" chip and lights up once its provider connects in Nexus.
let SEL=null;
function methodRow(m){
  const cls='method-row'+(m.available?'':' disabled')+(SEL&&SEL.id===m.id?' active':'');
  return \`
  <div class="\${cls}" data-m="\${m.id}" data-p="\${m.provider||''}" data-l="\${m.label}">
    <div class="method-l">
      <div class="method-logo logo-\${m.id}">\${m.label.split(' ')[0]}</div>
      <div>
        <div class="method-name">\${m.label}</div>
        \${m.sub?'<div class="method-sub">'+m.sub+'</div>':''}
      </div>
    </div>
    \${m.available?'<span class="method-chev">→</span>':'<span class="setup-chip">Setup required</span>'}
  </div>\`;
}
function cryptoChip(m){
  const cls='crypto-chip'+(m.available?'':' disabled')+(SEL&&SEL.id===m.id?' active':'');
  const sym={crypto_btc:'₿',crypto_eth:'Ξ',crypto_usdc:'$',crypto_usdt:'₮',crypto_sol:'◎',crypto_xrp:'✕'}[m.id]||'●';
  return \`
  <div class="\${cls}" data-m="\${m.id}" data-p="\${m.provider||''}" data-l="\${m.label}">
    <div class="crypto-sym sym-\${m.id}">\${sym}</div>
    <div class="crypto-label">\${m.label}</div>
  </div>\`;
}
const GROUP_NOTES={
  crypto:'Generates a QR code after confirmation. Approx. 10–15 min for network settlement.',
  p2p:'Opens a QR code in the app — scan and confirm in your wallet.',
};
async function renderCheckout(){
  const root=document.getElementById('co-root');
  if(!tok()){location.href='/cart';return}
  let c,reg;
  try{[c,reg]=await Promise.all([api('/cart',{useToken:true}),api('/checkout/methods')])}
  catch(e){location.href='/cart';return}
  const t=c.totals;
  if(!t.lines.length){location.href='/cart';return}
  const fmt=(m)=>(m/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
  const byGroup={};reg.methods.forEach(m=>{(byGroup[m.group]=byGroup[m.group]||[]).push(m)});
  const firstAvail=reg.methods.find(m=>m.available)||null;
  if(firstAvail&&!SEL)SEL={id:firstAvail.id,provider:firstAvail.provider,label:firstAvail.label};
  const selMethod=SEL?reg.methods.find(m=>m.id===SEL.id):null;
  const activeGroup=(selMethod||firstAvail||reg.methods[0]).group;

  const pills=reg.groups.map(g=>\`
    <button class="method-pill\${g.id===activeGroup?' active':''}" data-method="\${g.id}" type="button">
      <span class="pill-ico">\${g.ico}</span>\${g.label}
      <span class="preview">\${g.preview}</span>
    </button>\`).join('');
  const panels=reg.groups.map(g=>{
    const ms=byGroup[g.id]||[];
    const inner=g.id==='crypto'
      ?'<div class="crypto-grid">'+ms.map(cryptoChip).join('')+'</div>'
      :'<div class="method-list">'+ms.map(methodRow).join('')+'</div>';
    const note=GROUP_NOTES[g.id]?'<div class="method-note">'+GROUP_NOTES[g.id]+'</div>':'';
    return \`<div class="method-panel\${g.id===activeGroup?' active':''}" data-panel="\${g.id}">\${inner}\${note}</div>\`;
  }).join('');

  root.innerHTML=\`
  <div class="split">
    <div class="panel">
      <div style="margin-bottom:20px">
        <label for="email">Email for your receipt</label>
        <input type="email" id="email" placeholder="you@example.com" value="\${c.customerEmail||''}" autocomplete="email">
      </div>
      <label>Payment</label>
      <div class="method-strip" role="tablist">\${pills}</div>
      \${panels}
      <div id="co-msg"></div>
      <button class="btn" id="place" style="width:100%;margin-top:20px" \${SEL?'':'disabled'}>Place order · \${fmt(t.total)}</button>
    </div>
    <div class="panel">
      <div class="totals">
        \${t.lines.map(l=>'<div class="row muted"><span>'+l.quantity+' × '+l.productName+'</span><span class="num">'+fmt(l.lineTotal)+'</span></div>').join('')}
        \${t.coupon?'<div class="row muted"><span>Coupon '+t.coupon.code+'</span><span class="num">−'+fmt(t.coupon.amount)+'</span></div>':''}
        <div class="row grand"><span>Total</span><span class="num">\${fmt(t.total)}</span></div>
      </div>
    </div>
  </div>\`;

  root.querySelectorAll('.method-pill').forEach(p=>p.addEventListener('click',()=>{
    root.querySelectorAll('.method-pill').forEach(x=>x.classList.remove('active'));
    root.querySelectorAll('.method-panel').forEach(x=>x.classList.remove('active'));
    p.classList.add('active');
    root.querySelector('.method-panel[data-panel="'+p.dataset.method+'"]').classList.add('active');
  }));
  root.querySelectorAll('[data-m]').forEach(el=>el.addEventListener('click',()=>{
    if(el.classList.contains('disabled'))return;
    root.querySelectorAll('[data-m]').forEach(x=>x.classList.remove('active'));
    el.classList.add('active');
    SEL={id:el.dataset.m,provider:el.dataset.p,label:el.dataset.l};
    document.getElementById('place').disabled=false;
  }));

  document.getElementById('place').addEventListener('click',async(e)=>{
    const btn=e.target;const msg=document.getElementById('co-msg');
    const email=document.getElementById('email').value.trim();
    if(!SEL||!SEL.provider){msg.innerHTML='<p class="notice err">Pick a payment method.</p>';return}
    btn.disabled=true;btn.textContent='Placing order…';
    try{
      const order=await api('/cart/checkout',{method:'POST',body:JSON.stringify({cartToken:tok(),...(email?{email}:{})})});
      setTok(null);
      const intent=await api('/checkout/intent',{method:'POST',body:JSON.stringify({orderNumber:order.orderNumber,accessToken:order.accessToken,provider:SEL.provider})});
      if(intent.redirectUrl){location.href=intent.redirectUrl;return}
      location.href='/order-received/?order='+encodeURIComponent(order.orderNumber)+'&token='+encodeURIComponent(order.accessToken)+'&intent='+encodeURIComponent(intent.intentId||'');
    }catch(err){
      btn.disabled=false;btn.textContent='Place order';
      msg.innerHTML='<p class="notice err">'+err.message+'</p>';
      refreshCount();
    }
  });
}
document.addEventListener('DOMContentLoaded',renderCheckout);
`));
  });

  // ── /order-received/ — the receipt. Token-authenticated server-side with a
  //     constant-time compare; wrong token = generic not-found (no oracle). ──
  app.get('/order-received/', async (req, reply) => {
    if (!(await commerceOn())) return html(reply, closedPage());
    const { order: number, token } = req.query as { order?: string; token?: string };
    const notFound = (): void => {
      reply.status(404);
      html(reply, layout('Order — Therum Store', '<div class="empty-state"><div class="big">🔍</div><h1 class="page-title">Order not found</h1><p class="page-sub">Check the link from your receipt email.</p></div>'));
    };
    if (!number || !token) return notFound();
    const order = await db.order.findUnique({
      where: { number },
      include: { items: { include: { variant: { include: { product: { select: { name: true } } } } } }, payment: true },
    });
    if (!order?.accessToken) return notFound();
    const a = Buffer.from(order.accessToken);
    const b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return notFound();

    const paid = order.status !== 'pending';
    const rows = order.items.map((i) => `
      <div class="row muted"><span>${i.quantity} × ${esc(i.variant?.product?.name ?? 'Item')}${i.variant?.sku ? ` (${esc(i.variant.sku)})` : ''}</span><span class="num">${money(i.priceAtTime * i.quantity, order.currency)}</span></div>`).join('');

    html(reply, layout(`Order ${esc(order.number)} — Therum Store`, `
      <div style="max-width:560px;margin:0 auto">
        <div class="panel" style="text-align:center;margin-bottom:20px">
          <div style="font-size:40px;margin-bottom:8px">${paid ? '✅' : '🕒'}</div>
          <h1 class="page-title">${paid ? 'Thanks — order confirmed' : 'Order received'}</h1>
          <p class="page-sub" style="margin-bottom:0">Order <strong>${esc(order.number)}</strong>${order.guestEmail ? ` · receipt to ${esc(order.guestEmail)}` : ''}</p>
          ${paid ? '' : '<p class="pill" style="margin-top:10px">Awaiting payment confirmation</p>'}
        </div>
        <div class="panel">
          <div class="totals">
            ${rows}
            ${order.discountAmount > 0 ? `<div class="row muted"><span>${esc(order.discountLabel ?? 'Discount')}</span><span class="num">−${money(order.discountAmount, order.currency)}</span></div>` : ''}
            <div class="row grand"><span>Total</span><span class="num">${money(order.total, order.currency)}</span></div>
          </div>
        </div>
        <p style="text-align:center;margin-top:24px"><a href="/shop" style="color:var(--ac-btn);font-weight:600;font-size:14px">Continue shopping →</a></p>
      </div>`));
  });

  // Bare / belongs to the Base Theme site renderer (site.ts) — the shop is
  // one section of the public site, not its root.
}
