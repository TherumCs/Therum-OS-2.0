import type { FastifyInstance } from 'fastify';
import { db } from '../../lib/db.js';
import { requireCapability } from '../../middleware/capability.js';

// Feed manager backend (Counter's built-in "CTX Feed"). The feed XML itself is
// generated live by storefront.ts's feedHandler at /feed/*.xml; this endpoint
// is the ADMIN surface — the channels, their public URLs, the live eligible
// counts, and the connect instructions — so a merchant can wire Meta/Instagram
// and Google to the store without leaving Counter.

interface FeedChannel {
  key: string;
  label: string;
  path: string;
  format: string;
  /** Where this URL gets pasted, and the click-attribution tag it carries. */
  connect: string;
  source: string;
}

// One handler serves every channel; the path is the only difference, and the
// feed stamps th_src from it so a sale traced back to Meta reads as Meta.
const CHANNELS: FeedChannel[] = [
  {
    key: 'meta',
    label: 'Meta · Facebook & Instagram Shopping',
    path: '/feed/facebook.xml',
    format: 'XML (RSS 2.0, Google namespace)',
    connect:
      'Commerce Manager → Catalog → Data Sources → Add Items → Use a URL → paste this link, set the schedule to Daily.',
    source: 'meta',
  },
  {
    key: 'google',
    label: 'Google Shopping · Merchant Center',
    path: '/feed/google.xml',
    format: 'XML (RSS 2.0, Google namespace)',
    connect:
      'Merchant Center → Products → Feeds → Add primary feed → Scheduled fetch → paste this link, set frequency to Daily.',
    source: 'google',
  },
];

export async function feedRoutes(app: FastifyInstance): Promise<void> {
  // The public origin the feed URLs live on — the same one the feed's own links
  // use — NOT the admin host. PUBLIC_SITE_URL wins (it is what Meta/Google
  // actually fetch), then PUBLIC_ORIGIN.
  const origin = (process.env.PUBLIC_SITE_URL || process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, '');

  app.get('/feeds', { preHandler: [app.authenticate, requireCapability('commerce')] }, async (_req, reply) => {
    // Eligibility mirrors feedHandler EXACTLY: public + active + not deleted,
    // and a variant only counts if it carries a real price (the feed skips
    // price<=0). Counts that disagree with the feed are worse than no counts —
    // they read as "42 products live" when Meta receives 30.
    const products = await db.product.findMany({
      where: { deletedAt: null, status: 'active', visibility: 'public' },
      select: { variants: { select: { price: true, image: true } }, image: true, images: true },
    });
    let productCount = 0;
    let variantCount = 0;
    for (const p of products) {
      const primary = p.image || (Array.isArray(p.images) && (p.images[0] as { url?: string } | undefined)?.url) || '';
      const eligible = p.variants.filter((v) => v.price != null && v.price > 0 && (v.image || primary));
      if (eligible.length) {
        productCount += 1;
        variantCount += eligible.length;
      }
    }

    reply.send({
      origin,
      productCount,
      variantCount,
      channels: CHANNELS.map((c) => ({
        key: c.key,
        label: c.label,
        format: c.format,
        connect: c.connect,
        // The absolute URL a merchant pastes. th_src tags the click so an order
        // off this channel attributes to it (order.meta.source), which is how
        // "the order hits the right place" back in the dashboard.
        url: origin ? `${origin}${c.path}?th_src=${c.source}` : `${c.path}?th_src=${c.source}`,
      })),
    });
  });
}
