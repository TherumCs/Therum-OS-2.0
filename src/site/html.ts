/**
 * Near-leaf HTML helpers.
 *
 * These lived in storefrontHtml.ts, which also pulls CSS constants from
 * productGrid.ts and shopToolbar.ts. Those two need `esc`, so the import graph
 * looped: storefrontHtml -> productGrid -> storefrontHtml. Two of the four
 * cycles madge reported were exactly this, and both dissolve by putting the
 * leaf utilities in a leaf module. The ONLY import here is the currency
 * formatter (currency.ts -> errors.js) — it never imports back through the
 * storefront graph, so it adds no cycle, and it lets money() format
 * zero/three-decimal currencies correctly instead of a blanket /100.
 */
import { formatMoney } from '../counter/currency.js';

/**
 * Escape for HTML text and attributes.
 *
 * The single quote is NOT optional. Browser-side copies of this function
 * escaped only [&<>"], which is safe in double-quoted attributes and an XSS
 * hole in single-quoted ones — and this codebase writes both. Six copies had
 * drifted that way; `test/site.test.mjs` now fails if a seventh appears.
 */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** Minor units to a display string. Money is integer minor units everywhere. */
export function money(minor: number, currency = 'USD'): string {
  // Delegates to the currency-aware formatter (currency.ts → errors.js only, no
  // cycle back through this leaf) so zero/three-decimal currencies (JPY, KWD)
  // render right instead of the old blanket /100. Falls back to a plain
  // 2-decimal format if the code is unknown to the catalog.
  try {
    return formatMoney(minor, currency);
  } catch {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);
  }
}
