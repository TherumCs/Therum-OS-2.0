import { db } from '../lib/db.js';
import { renderCanvas, type CanvasNode } from '../lib/render.js';

// Counter's default templates — the Woo-shaped thing Bam has asked for
// repeatedly and that did not exist.
//
// Until now shop, PDP, cart, checkout and account were rendered by hardcoded
// TypeScript (productGrid.ts, checkoutFlow.ts, accountPage.ts). That means the
// screens a merchant most wants to lay out are the only ones they cannot touch,
// and every visual change to them is a code edit and a deploy. Woo ships
// editable templates for exactly these screens; this is that.
//
// THE FALLBACK IS THE POINT. A store with no template for a slot renders
// exactly what it renders today. Templates are additive: publishing one takes
// over a screen, unpublishing gives it back. Nothing about this can leave a
// store with a blank shop page, which is the failure mode that would make the
// feature worse than not having it.

export const TEMPLATE_SLOTS = [
  'shop', 'product', 'cart', 'checkout', 'account', 'wishlist', 'order-tracking',
] as const;
export type TemplateSlot = (typeof TEMPLATE_SLOTS)[number];

/** Slot -> the content slug that holds it. */
export const templateSlug = (slot: TemplateSlot): string => `counter-template-${slot}`;

export function isTemplateSlot(v: string): v is TemplateSlot {
  return (TEMPLATE_SLOTS as readonly string[]).includes(v);
}

/**
 * The published template for a slot, already rendered — or null to use the
 * built-in screen.
 *
 * Draft templates deliberately do NOT take over: a merchant editing the
 * checkout must be able to save work in progress without the live checkout
 * following along.
 */
export async function templateHtml(slot: TemplateSlot): Promise<string | null> {
  const row = await db.content.findFirst({
    where: { slug: templateSlug(slot), type: 'template', status: 'published', deletedAt: null },
    select: { body: true },
  });
  if (!row?.body) return null;
  const html = renderCanvas(row.body as unknown as CanvasNode);
  // An empty render is a broken template, and swapping a working screen for a
  // blank one is worse than ignoring it.
  return html.trim().length > 0 ? html : null;
}

/** Which slots currently have a published template, for the Counter screen. */
export async function templateStatus(): Promise<Record<TemplateSlot, boolean>> {
  const rows = await db.content.findMany({
    where: { type: 'template', status: 'published', deletedAt: null },
    select: { slug: true },
  });
  const live = new Set(rows.map((r) => r.slug));
  return Object.fromEntries(
    TEMPLATE_SLOTS.map((s) => [s, live.has(templateSlug(s))]),
  ) as Record<TemplateSlot, boolean>;
}

/**
 * Create the default template rows for any slot that has none.
 *
 * Seeded as DRAFTS carrying the screen's current markup, so installing
 * defaults changes nothing until a merchant publishes one. That ordering
 * matters: a seed that went live immediately would silently replace a working
 * storefront the first time someone ran it.
 */
export async function seedDefaults(
  markupFor: (slot: TemplateSlot) => Promise<string> | string,
): Promise<{ created: TemplateSlot[]; skipped: TemplateSlot[] }> {
  const created: TemplateSlot[] = [];
  const skipped: TemplateSlot[] = [];
  for (const slot of TEMPLATE_SLOTS) {
    const slug = templateSlug(slot);
    const existing = await db.content.findFirst({ where: { slug }, select: { id: true } });
    if (existing) { skipped.push(slot); continue; }
    const html = await markupFor(slot);
    await db.content.create({
      data: {
        type: 'template',
        slug,
        title: `Counter template — ${slot}`,
        status: 'draft',
        // Stored as a single raw-HTML node: the built-in screens are HTML, and
        // round-tripping them into builder nodes would change them before the
        // merchant has touched anything.
        body: {
          id: 'root',
          type: 'section',
          props: { __name: 'div', __bricks: { _cssClasses: `counter-template counter-template--${slot}` }, content: html },
          children: [],
        } as unknown as object,
        updatedAt: new Date(),
      },
    });
    created.push(slot);
  }
  return { created, skipped };
}

/**
 * The markup a slot renders today, used to seed its default template.
 *
 * Imported lazily and per-slot: these modules pull in the whole storefront
 * rendering stack, and a template helper that dragged that into every consumer
 * would make the dependency graph worse than the problem it solves.
 *
 * A slot whose built-in markup cannot be produced without a live request
 * (anything needing the shopper's cart or the product being viewed) seeds as a
 * placeholder naming what it is, rather than a fabricated approximation of a
 * screen — PORTING.md rule 1: nothing invented.
 */
export async function builtInMarkupFor(slot: TemplateSlot): Promise<string> {
  switch (slot) {
    case 'cart':
    case 'checkout': {
      const { checkoutFlowMarkup } = await import('../site/checkoutFlow.js');
      return checkoutFlowMarkup();
    }
    case 'account': {
      const { accountMarkup } = await import('../site/accountPage.js');
      const { wishlistMarkup } = await import('../site/wishlist.js');
      // Seeded without a Google client id: the id belongs to the live request,
      // and baking one into stored content would pin it at seed time.
      return accountMarkup(wishlistMarkup(), '');
    }
    case 'wishlist': {
      const { wishlistMarkup } = await import('../site/wishlist.js');
      return wishlistMarkup();
    }
    default:
      return `<div class="counter-template__placeholder" data-slot="${slot}">`
        + `This template renders the ${slot} screen. Its built-in version is `
        + 'generated per request from live data, so there is nothing static to '
        + 'copy here — build the layout you want and publish to take the screen '
        + 'over.</div>';
  }
}
