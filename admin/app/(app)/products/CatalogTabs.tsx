import Link from 'next/link';

// The Product Catalog's own tab bar.
//
// Everything that describes a product lives behind one heading: the products
// themselves, the categories they sit in, the tags on them, and the importer
// that creates them. Categories and tags used to have no screen at all — they
// could only be ticked from inside a single product, so there was nowhere to
// see the shape of the catalogue or to fix it.
//
// These are LINKS, not client-side tab state: each panel loads its own data
// server-side, and a category manager you cannot link someone to (or reload
// onto) is a worse tool for no gain.

export type CatalogTab = 'products' | 'categories' | 'tags' | 'import';

const TABS: { id: CatalogTab; href: string; label: string }[] = [
  { id: 'products', href: '/products', label: 'Products' },
  { id: 'categories', href: '/products/categories', label: 'Categories' },
  { id: 'tags', href: '/products/tags', label: 'Tags' },
  { id: 'import', href: '/products/import', label: 'Import' },
];

export function CatalogTabs({ current, counts }: { current: CatalogTab; counts?: Partial<Record<CatalogTab, number>> }) {
  return (
    <div className="th-tabs" role="tablist" aria-label="Product catalog">
      {TABS.map((t) => {
        const n = counts?.[t.id];
        return (
          <Link
            key={t.id}
            href={t.href}
            role="tab"
            aria-selected={current === t.id}
            aria-current={current === t.id ? 'page' : undefined}
            className={'th-tab' + (current === t.id ? ' on' : '')}
          >
            {t.label}
            {typeof n === 'number' && <span className="th-tab__count">{n}</span>}
          </Link>
        );
      })}
    </div>
  );
}
