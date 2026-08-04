import { apiGet } from '../../../lib/api';
import { CustomizationClient, type CounterSettings } from './CustomizationClient';

export const dynamic = 'force-dynamic';

// Counter > Customization — how the STOREFRONT presents itself.
//
// Deliberately separate from Commerce, which holds facts about the store (its
// currency). These are choices about its shopfront, and mixing the two means a
// currency change and a card-layout change look like the same kind of edit.
//
// It lives under Counter rather than in Settings because it is about running
// this store, not about running the install — a merchant changing a product
// card should not have to go looking under the same roof as SMTP and backups.
//
// The page BATCHES its edits behind one Save (see app/(app)/SettingsForm.tsx),
// unlike the save-on-change Settings pages: the choices here are visual and
// compared against each other, and clicking through five card layouts should
// not publish four of them to the live storefront on the way to the fifth.
const DEFAULTS: CounterSettings = {
  cartStyle: 'sidebar',
  cartSidebarReveal: 'push',
  cartSidebarGround: '#0a0a0a',
  cardShell: 'bare',
  cardMedia: 'auto',
  cardMediaSecondary: 'still',
  cardPreset: 'editorial',
  cardAction: 'none',
  cardEvolve: true,
  cardAlign: 'start',
  cardRadius: 'sharp',
  cardRatio: 'square',
  cardFit: 'cover',
  cardShadow: 'soft',
  cardHover: 'none',
  cardGap: 'normal',
  cardReveal: 'none',
  cardSubtitle: true,
  cardBadges: true,
  memberPricing: 'net',
  memberPriceLabel: 'Your price',
  toolbarEnabled: true,
  toolbarStyle: 'bar',
  toolbarSearch: true,
  toolbarFilters: true,
  toolbarSort: true,
  toolbarView: true,
  toolbarCount: true,
  toolbarColumns: 4,
  toolbarPageSize: 24,
  toolbarSearchPlaceholder: '',
  toolbarFilterFields: ['category', 'tags', 'color', 'size'],
  toolbarSorts: ['new', 'name', 'price-asc', 'price-desc'],
  toolbarDefaultSort: 'new',
  searchStyle: 'takeover',
  searchLayout: 'grid',
  wishlistEnabled: true,
  wishlistOnCards: true,
};

export default async function CustomizationPage() {
  const settings = await apiGet<CounterSettings>('/api/settings/counter').catch(() => DEFAULTS);

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>Customization</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        How the storefront presents itself — the cart, the product cards, the shop toolbar, search and the wishlist.
        Changes go live when you save.
      </p>

      <CustomizationClient initial={settings} />
    </div>
  );
}
