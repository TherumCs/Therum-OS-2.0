// Carrier tracking links.
//
// `OrderShipment.trackingCarrier` is a free-text string written by whichever
// provider or human filled it in, so it arrives as "ups", "UPS", "United
// Parcel Service" or "usps " depending on the source. This normalises that and
// hands back a real tracking URL.
//
// A carrier we do not recognise returns a null url rather than a guessed one:
// a link that 404s on the carrier's own site is worse than no link, because
// the shopper blames the store for losing their parcel.

export interface Carrier {
  id: string;
  name: string;
  /** `{n}` is replaced with the tracking number, URL-encoded. */
  url: string;
  /** Strings that should resolve to this carrier, lowercased. */
  aliases: string[];
}

const CARRIERS: Carrier[] = [
  { id: 'ups', name: 'UPS', url: 'https://www.ups.com/track?tracknum={n}', aliases: ['ups', 'united parcel service'] },
  { id: 'usps', name: 'USPS', url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels={n}', aliases: ['usps', 'united states postal service', 'us postal service'] },
  { id: 'fedex', name: 'FedEx', url: 'https://www.fedex.com/fedextrack/?trknbr={n}', aliases: ['fedex', 'fed ex', 'federal express'] },
  { id: 'dhl', name: 'DHL', url: 'https://www.dhl.com/en/express/tracking.html?AWB={n}', aliases: ['dhl', 'dhl express', 'dhl ecommerce'] },
  { id: 'royal-mail', name: 'Royal Mail', url: 'https://www.royalmail.com/track-your-item#/tracking-results/{n}', aliases: ['royal mail', 'royalmail'] },
  { id: 'evri', name: 'Evri', url: 'https://www.evri.com/track/parcel/{n}', aliases: ['evri', 'hermes'] },
  { id: 'dpd', name: 'DPD', url: 'https://track.dpd.co.uk/search?reference={n}', aliases: ['dpd'] },
  { id: 'canada-post', name: 'Canada Post', url: 'https://www.canadapost-postescanada.ca/track-reperage/en#/resultList?searchFor={n}', aliases: ['canada post', 'canadapost'] },
  { id: 'australia-post', name: 'Australia Post', url: 'https://auspost.com.au/mypost/track/details/{n}', aliases: ['australia post', 'auspost'] },
  { id: 'gls', name: 'GLS', url: 'https://gls-group.eu/track/{n}', aliases: ['gls'] },
  { id: 'ontrac', name: 'OnTrac', url: 'https://www.ontrac.com/tracking/?number={n}', aliases: ['ontrac'] },
  // Printful and Printify hand back the underlying carrier, but some
  // integrations write the POD partner's name instead. Falling through to
  // their own status pages is better than a dead link.
  { id: 'printful', name: 'Printful', url: 'https://www.printful.com/dashboard/order/{n}', aliases: ['printful'] },
];

/** Resolve a free-text carrier string, or null when we do not know it. */
export function findCarrier(raw: string | null | undefined): Carrier | null {
  if (!raw) return null;
  const needle = raw.trim().toLowerCase();
  if (!needle) return null;
  return (
    CARRIERS.find((c) => c.aliases.includes(needle)) ??
    // A looser pass for values like "UPS Ground" or "USPS Priority Mail" —
    // matched only on a word boundary so "gls" cannot match "englishgls".
    CARRIERS.find((c) => c.aliases.some((a) => new RegExp(`(^|[^a-z])${a}([^a-z]|$)`).test(needle))) ??
    null
  );
}

/** The shopper-facing tracking link, or null if we cannot build a real one. */
export function trackingUrl(carrier: string | null | undefined, number: string | null | undefined): string | null {
  const c = findCarrier(carrier);
  if (!c || !number?.trim()) return null;
  return c.url.replace('{n}', encodeURIComponent(number.trim()));
}

/** Display name — the carrier's proper name when known, else what we were told. */
export function carrierName(raw: string | null | undefined): string | null {
  return findCarrier(raw)?.name ?? (raw?.trim() || null);
}
