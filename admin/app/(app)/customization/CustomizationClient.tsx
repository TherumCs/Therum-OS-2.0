'use client';

import { SettingsForm } from '../SettingsForm';
import { FormCheckList, FormColor, FormPresetNumber, FormSelect, FormText, FormToggle } from '../FormControls';
import { ACTION_PREVIEWS, ALIGN_PREVIEWS, MEDIA_PREVIEWS, PRESET_PREVIEWS, GAP_PREVIEWS, HOVER_PREVIEWS, PreviewPicker, RADIUS_PREVIEWS, RATIO_PREVIEWS, REVEAL_PREVIEWS, SEARCH_LAYOUT_PREVIEWS, SEARCH_PREVIEWS, SHADOW_PREVIEWS, SHELL_PREVIEWS, TOOLBAR_PREVIEWS } from '../CardPreviews';
import { ShippingSettings } from './ShippingSettings';

export interface CounterSettings extends Record<string, unknown> {
  cartStyle: 'mini' | 'sidebar';
  cartSidebarReveal: 'overlay' | 'push';
  cartMobile: 'drawer' | 'page';
  cartSidebarGround: string;
  cardShell: 'bare' | 'boxed' | 'elevated';
  cardMedia: 'auto' | 'still' | 'fade' | 'gallery' | 'motion';
  cardMediaSecondary: 'auto' | 'still' | 'fade' | 'gallery' | 'motion';
  cardPreset: 'editorial' | 'retail' | 'detailed' | 'sneaker' | 'data';
  cardAction: 'none' | 'below' | 'overlay' | 'dual' | 'icons';
  cardEvolve: boolean;
  cardAlign: 'start' | 'center' | 'end';
  cardRadius: 'sharp' | 'soft' | 'round' | 'pill' | 'squircle';
  buttonShape: 'sharp' | 'soft' | 'round' | 'pill';
  cardRatio: 'square' | 'portrait' | 'tall' | 'landscape' | 'natural';
  cardFit: 'cover' | 'contain';
  cardShadow: 'none' | 'soft' | 'strong';
  cardHover: 'none' | 'lift' | 'zoom' | 'both';
  cardGap: 'tight' | 'normal' | 'roomy';
  cardReveal: 'none' | 'fade' | 'rise' | 'stagger';
  cardSubtitle: boolean;
  cardBadges: boolean;
  pdpStyle: 'classic' | 'apple' | 'athletic' | 'editorial';
  pdpImageSide: 'left' | 'right';
  pdpThumbs: 'bottom' | 'side' | 'none';
  memberPricing: 'off' | 'net' | 'was-now';
  memberPriceLabel: string;
  toolbarEnabled: boolean;
  toolbarStyle: 'bar' | 'minimal';
  toolbarSearch: boolean;
  toolbarFilters: boolean;
  toolbarSort: boolean;
  toolbarView: boolean;
  toolbarCount: boolean;
  toolbarColumns: number;
  toolbarPageSize: number;
  toolbarSearchPlaceholder: string;
  toolbarFilterFields: string[];
  toolbarSorts: string[];
  toolbarDefaultSort: string;
  searchStyle: 'takeover' | 'inline' | 'fullwidth' | 'immersive';
  searchLayout: 'list' | 'grid' | 'categories' | 'slider';
  wishlistEnabled: boolean;
  wishlistOnCards: boolean;
  // ── Shipping (edited by <ShippingSettings/>) ──────────────────────────────
  shippingZones?: { id: string; name: string; states: string[]; isRest?: boolean }[];
  shippingMethods?: { id: string; name: string; detail: string; prices: Record<string, number>; amount?: number; freeOver: number | null; enabled: boolean }[];
  pickup?: { enabled: boolean; price: number; address: string; note: string };
  freeShippingOver?: number;
}

// Dark, light, and a way out to anything. Bam's list, plus one mid grey so
// there is a step between ink and eggshell.
const GROUND_PRESETS: [string, string][] = [
  ['#0a0a0a', 'Ink'],
  ['#3f3f43', 'Grey'],
  ['#f0ece4', 'Eggshell'],
  ['#faf1e0', 'Cream'],
];

const MEDIA_OPTIONS: [string, string, string?][] = [
  ['auto', 'Auto', 'The product decides: video plays, several photos get arrows.'],
  ['still', 'Still', 'One photo. Nothing on hover.'],
  ['fade', 'Fade', 'Second photo cross-fades in.'],
  ['gallery', 'Gallery', 'Arrows and dots through every photo.'],
  ['motion', 'Motion', 'Hover plays the product video.'],
];

export function CustomizationClient({ initial }: { initial: CounterSettings }) {
  return (
    <SettingsForm domain="counter" initial={initial}>
      <div className="settings-group">
        <h3 className="settings-group-title">Cart</h3>
        <p className="settings-group-desc">Both read the same cart — this is purely how it opens.</p>
        <FormSelect
          label="Cart style"
          desc="Mini drops a panel under the bag. Sidebar opens a full-height drawer."
          field="cartStyle"
          options={[
            ['sidebar', 'Sidebar drawer'],
            ['mini', 'Mini dropdown'],
          ]}
        />
        <FormSelect
          label="Sidebar reveal"
          desc="Overlay slides the drawer over the page. Shift slides the page aside so the cart is revealed from under it, and nothing gets covered."
          field="cartSidebarReveal"
          options={[
            ['push', 'Shift the page'],
            ['overlay', 'Overlay the page'],
          ]}
        />
        <FormSelect
          label="Cart on mobile"
          desc="On phones, tapping the bag can slide the drawer out or open the full cart page. Choose whichever feels right — the page is the most reliable, the drawer keeps them where they were shopping."
          field="cartMobile"
          options={[
            ['drawer', 'Slide-out drawer'],
            ['page', 'Go to the cart page'],
          ]}
        />
        <FormColor
          label="Ground colour"
          desc="What the shifted page uncovers. The cart sits directly on it, and its type flips light or dark to stay readable. Only used when the sidebar shifts the page."
          field="cartSidebarGround"
          presets={GROUND_PRESETS}
        />
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Product cards</h3>
        <p className="settings-group-desc">
          Store-wide defaults. Any single product can override its media behaviour and its information layout from the
          product editor, so one odd item does not force a different setting on the whole shop.
        </p>

        <PreviewPicker
          label="Card shell"
          desc="Does the card have a container, or is it just the image on the page?"
          field="cardShell"
          previews={SHELL_PREVIEWS}
          options={[
            ['bare', 'Bare', 'Image on the page, text underneath.'],
            ['boxed', 'Boxed', 'A surface with a hairline.'],
            ['elevated', 'Elevated', 'Raised, with the image inset as a tile.'],
          ]}
        />

        <PreviewPicker
          label="Corners"
          desc="Applied to the card and its image together, so a rounded card never holds a square photo. Squircle is a superellipse — a continuous corner rather than an arc; browsers that can't draw one fall back to Round."
          field="cardRadius"
          previews={RADIUS_PREVIEWS}
          options={[
            ['sharp', 'Sharp', 'No radius.'],
            ['soft', 'Soft', 'Barely there.'],
            ['round', 'Round', ''],
            ['pill', 'Pill', 'Heavily rounded.'],
            ['squircle', 'Squircle', 'Continuous corner.'],
          ]}
        />

        <PreviewPicker
          label="Button shape"
          desc="Corner radius on storefront buttons — Add to cart, checkout, everywhere they appear."
          field="buttonShape"
          previews={RADIUS_PREVIEWS}
          options={[
            ['sharp', 'Sharp', 'No radius.'],
            ['soft', 'Soft', 'Barely there.'],
            ['round', 'Round', 'Rounded corners.'],
            ['pill', 'Pill', 'Fully rounded.'],
          ]}
        />

        <PreviewPicker
          label="Image shape"
          desc="Natural lets each photo keep its own proportions — the grid stops being uniform, which suits a mixed catalogue and hurts a tidy one."
          field="cardRatio"
          previews={RATIO_PREVIEWS}
          options={[
            ['square', 'Square', '1:1'],
            ['portrait', 'Portrait', '4:5'],
            ['tall', 'Tall', '2:3'],
            ['landscape', 'Landscape', '4:3'],
            ['natural', 'Natural', 'The photo decides.'],
          ]}
        />

        <FormSelect
          label="Image fill"
          desc="Cover crops to fill the frame. Contain fits the whole photo inside it and leaves space — right for products shot on white with a lot of air."
          field="cardFit"
          options={[
            ['cover', 'Cover — crop to fill'],
            ['contain', 'Contain — fit inside'],
          ]}
        />

        <PreviewPicker
          label="Shadow"
          desc="Only does anything on a Boxed or Elevated shell — a bare card has nothing to cast one."
          field="cardShadow"
          previews={SHADOW_PREVIEWS}
          options={[
            ['none', 'None', ''],
            ['soft', 'Soft', ''],
            ['strong', 'Strong', ''],
          ]}
        />

        <PreviewPicker
          label="Hover"
          desc="The lift moves the card; the zoom moves the photo inside its frame, so the grid itself never ripples."
          field="cardHover"
          previews={HOVER_PREVIEWS}
          options={[
            ['none', 'None', ''],
            ['lift', 'Lift', 'The card rises.'],
            ['zoom', 'Zoom', 'The photo scales.'],
            ['both', 'Both', ''],
          ]}
        />

        <PreviewPicker
          label="Grid spacing"
          desc="Space between cards."
          field="cardGap"
          previews={GAP_PREVIEWS}
          options={[
            ['tight', 'Tight', ''],
            ['normal', 'Normal', ''],
            ['roomy', 'Roomy', ''],
          ]}
        />

        <PreviewPicker
          label="Media behaviour — primary"
          desc="What the image does on a product that can support it. Auto reads each product and picks — a video plays on hover, several photos get arrows, one photo stays still."
          field="cardMedia"
          previews={MEDIA_PREVIEWS}
          options={MEDIA_OPTIONS}
        />

        <PreviewPicker
          label="Media behaviour — secondary"
          desc="What a product falls back to when it can't do the primary — no video for Motion, a single photo for Gallery or Fade. Still always works, which is why anything that can't do the secondary either lands there."
          field="cardMediaSecondary"
          previews={MEDIA_PREVIEWS}
          options={MEDIA_OPTIONS}
        />

        <PreviewPicker
          label="Information"
          desc="Which rows the card carries."
          field="cardPreset"
          previews={PRESET_PREVIEWS}
          options={[
            ['editorial', 'Editorial', 'Name, price, colour swatches.'],
            ['retail', 'Retail', 'Price beside the name, plus a subtitle.'],
            ['detailed', 'Detailed', 'Spec line and swatches.'],
            ['sneaker', 'Sneaker', 'Brand pill, rating, size chips.'],
            ['data', 'Data', 'Info tiles and a was-price.'],
          ]}
        />

        <PreviewPicker
          label="Content alignment"
          desc="The text block under the image. The image itself always fills its shell — aligning that would leave dead space beside the product."
          field="cardAlign"
          previews={ALIGN_PREVIEWS}
          options={[
            ['start', 'Left', ''],
            ['center', 'Centred', ''],
            ['end', 'Right', ''],
          ]}
        />

        <PreviewPicker
          label="Buy action"
          desc="Where the buy control lives. None is the only one with no add-to-cart at all — it sends the whole card to the product page."
          field="cardAction"
          previews={ACTION_PREVIEWS}
          options={[
            ['none', 'None', 'The card links to the product page.'],
            ['below', 'One button', 'Under the price.'],
            ['dual', 'Two buttons', 'Add to cart + Explore.'],
            ['icons', 'Icons', 'Heart and bag.'],
            ['overlay', 'Overlay', 'On the image, revealed on hover.'],
          ]}
        />

        <FormToggle
          label="Evolve in place"
          desc="A product with sizes or colours flips the card into a picker right there instead of sending the shopper to the product page — then hands off to the same quick-buy sheet. Applies to every buy action except None, which has nothing to evolve."
          field="cardEvolve"
        />

        <PreviewPicker
          label="Content reveal"
          desc="How the card arrives as it scrolls into view. Skipped entirely for anyone who has asked their system for reduced motion."
          field="cardReveal"
          previews={REVEAL_PREVIEWS}
          options={[
            ['none', 'None', 'Just there.'],
            ['fade', 'Fade', 'Fades in.'],
            ['rise', 'Rise', 'Fades in and lifts.'],
            ['stagger', 'Stagger', 'Rows arrive one after another.'],
          ]}
        />

        <FormToggle label="Subtitle line" desc="Category or vendor under the product name." field="cardSubtitle" />
        <FormToggle label="Stock badges" desc="Sold out and low-stock marks on the image." field="cardBadges" />
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Product page</h3>
        <p className="settings-group-desc">
          Store-wide layout for every product page. One markup tree, four arrangements. A single product can override it
          from the product editor.
        </p>
        <FormSelect
          label="Layout"
          desc="Classic ships gallery-left, details-right. Apple centres one large image with room to breathe. Athletic is a full-bleed hero with the details floating over it. Editorial leads with an oversized wordmark and puts the price inside the buy button."
          field="pdpStyle"
          options={[
            ['classic', 'Classic — gallery + details'],
            ['apple', 'Apple — centred'],
            ['athletic', 'Athletic — full-bleed hero'],
            ['editorial', 'Editorial — big type'],
          ]}
        />
        <FormSelect
          label="Images on"
          desc="Which side the gallery sits on. Ignored by the centred and full-bleed layouts. The gallery stays first in the source, so a keyboard reaches the product before the form."
          field="pdpImageSide"
          options={[
            ['left', 'Left'],
            ['right', 'Right'],
          ]}
        />
        <FormSelect
          label="Thumbnails"
          desc="Where the thumbnail strip sits."
          field="pdpThumbs"
          options={[
            ['bottom', 'Below the image'],
            ['side', 'Beside the image'],
            ['none', 'Hidden'],
          ]}
        />
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Member pricing</h3>
        <p className="settings-group-desc">
          What a Milieus member (friends and family, wholesale, a members club) sees. Their discount already
          applies at checkout — this decides whether the storefront shows it. A page priced for a member is
          per-shopper, so it is not shared-cacheable.
        </p>
        <FormSelect
          label="Show member prices"
          desc="Net replaces the number: their price IS the price, no strike-through. A strike-through is a sale device — it works because it's temporary, and a permanent “was $80” only makes the $80 look like the lie. Sale pricing keeps its strike-through either way; these are two different things."
          field="memberPricing"
          options={[
            ['net', 'Net — their price is the price'],
            ['was-now', 'Was / now — show the saving'],
            ['off', 'Off — list price until checkout'],
          ]}
        />
        <FormText
          label="Price label"
          desc="A quiet line under a member price. Without one, a member can't tell why their prices differ from a friend's — and the value of the group is invisible."
          field="memberPriceLabel"
          placeholder="Your price"
        />
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Shop toolbar</h3>
        <p className="settings-group-desc">
          The bar above the grid. Anything switched off is not rendered at all rather than hidden — a control nobody can
          see should not still be in the keyboard tab order.
        </p>
        <FormToggle label="Show the toolbar" desc="Off leaves the grid on its own." field="toolbarEnabled" />
        <PreviewPicker
          label="Toolbar style"
          desc="Minimal is just the icons until one is tapped — it expands into that control in place and closes whatever was open. An applied filter still shows a dot, so a filtered grid never looks unfiltered."
          field="toolbarStyle"
          previews={TOOLBAR_PREVIEWS}
          options={[
            ['bar', 'Full bar', 'Search across the top, controls underneath.'],
            ['minimal', 'Minimal', 'Icons only. Expands on tap.'],
          ]}
        />
        <FormToggle label="Search" desc="Full-width search field across the top of the bar." field="toolbarSearch" />
        <FormToggle label="Sort control" desc="Off hides the Sort pill; the default below still orders the grid." field="toolbarSort" />
        <FormToggle label="View controls" desc="Grid/list switch and the column count." field="toolbarView" />
        <FormToggle label="Result count" desc="“12 products” and the Clear link." field="toolbarCount" />

        <FormCheckList
          label="Filters"
          desc="Which filter pills to offer. A pill whose products have no values behind it opens an empty list, so this is a choice rather than something to infer."
          field="toolbarFilterFields"
          options={[
            ['category', 'Category', 'Product categories.'],
            ['tags', 'Tags', 'Flat tags.'],
            ['color', 'Colour', 'From variant colours.'],
            ['size', 'Size', 'Chip grid, from variant sizes.'],
            ['brand', 'Brand', 'Vendor name.'],
            ['price', 'Price', 'Under / over bands from live prices.'],
            ['availability', 'In stock only', 'Hides sold-out products.'],
          ]}
        />

        <FormCheckList
          label="Sort options"
          desc="Which orderings a shopper can pick. Price sorts on the lowest variant price and best-selling on real order counts — neither is approximated."
          field="toolbarSorts"
          options={[
            ['new', 'Newest', 'Most recently added.'],
            ['oldest', 'Oldest', 'Longest-standing first.'],
            ['name', 'A–Z', 'By product name.'],
            ['name-desc', 'Z–A', ''],
            ['price-asc', 'Price: low to high', ''],
            ['price-desc', 'Price: high to low', ''],
            ['best-selling', 'Best selling', 'By units actually ordered.'],
          ]}
        />

        <FormSelect
          label="Default sort"
          desc="What the grid is ordered by before a shopper chooses. Pick one you have switched on above."
          field="toolbarDefaultSort"
          options={[
            ['new', 'Newest'],
            ['oldest', 'Oldest'],
            ['name', 'A–Z'],
            ['name-desc', 'Z–A'],
            ['price-asc', 'Price: low to high'],
            ['price-desc', 'Price: high to low'],
            ['best-selling', 'Best selling'],
          ]}
        />

        <FormPresetNumber
          label="Columns"
          desc="Starting column count. A shopper who changes it keeps their own choice on that device."
          field="toolbarColumns"
          presets={[2, 3, 4, 5, 6]}
          min={2}
          max={6}
        />

        <FormPresetNumber
          label="Products per page"
          desc="How many products the grid loads at once. 24 suits most stores; go higher only if the images are small."
          field="toolbarPageSize"
          presets={[12, 24, 36, 48, 60, 96]}
          min={4}
          max={120}
          suffix="max 120"
        />
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Header search</h3>
        <PreviewPicker
          label="Search style"
          desc="What happens when the magnifier is tapped."
          field="searchStyle"
          previews={SEARCH_PREVIEWS}
          options={[
            ['takeover', 'Takeover', 'Fills the screen. Best for a deliberate search.'],
            ['inline', 'Inline', 'Drops under the header as a card. The page stays put.'],
            ['fullwidth', 'Full width', 'Drops under the header edge to edge, spanning the page.'],
            ['immersive', 'Immersive', 'The page empties and refills with results as you type.'],
          ]}
        />
        <PreviewPicker
          label="Result layout"
          desc="How the matches are arranged, whichever search style is on."
          field="searchLayout"
          previews={SEARCH_LAYOUT_PREVIEWS}
          options={[
            ['list', 'List', 'One per row with a small thumbnail. Most results in view.'],
            ['grid', 'Grid', 'Two across, large images. Best when the photograph sells it.'],
            ['categories', 'Categories', 'Grouped under each category, with a count and thumbnails.'],
            ['slider', 'Slider', 'One swipeable row. Keeps the page short on a phone.'],
          ]}
        />
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Wishlist</h3>
        <p className="settings-group-desc">
          Saved items live in the shopper&apos;s own browser, so the list follows them around this device and does not
          follow them to another one.
        </p>
        <FormToggle
          label="Wishlist"
          desc="Off removes the header heart, the count and the /wishlist page."
          field="wishlistEnabled"
        />
        <FormToggle
          label="Heart on product cards"
          desc="Off keeps the wishlist page reachable but takes the heart off the grid."
          field="wishlistOnCards"
        />
      </div>
      <ShippingSettings />
    </SettingsForm>
  );
}
