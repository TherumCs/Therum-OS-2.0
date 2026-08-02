export interface Variant {
  id: string;
  sku: string | null;
  price: number;
  inventory: number;
  reserved: number;
}
export interface Product {
  id: string;
  name: string;
  slug: string;
  status: string;
  /** Primary image — the catalogue list shows it as a thumbnail. */
  image?: string | null;
  variants: Variant[];
}
export interface OrderItem {
  id: string;
  quantity: number;
  priceAtTime: number;
  variant: { sku: string | null } | null;
}
export interface Order {
  id: string;
  number: string;
  status: string;
  total: number;
  currency: string;
  items: OrderItem[];
  payment: { status: string } | null;
}
export interface Extension {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  health: string;
  activeHooks: number;
}
export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
  /** Rows matching the current filters, ignoring paging. */
  total?: number;
}

export function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const units: [number, string][] = [
    [60, 's'],
    [60, 'm'],
    [24, 'h'],
    [7, 'd'],
    [4.345, 'w'],
    [12, 'mo'],
    [Number.POSITIVE_INFINITY, 'y'],
  ];
  let value = seconds;
  for (const [size, label] of units) {
    if (value < size) return `${Math.max(1, Math.floor(value))}${label} ago`;
    value = value / size;
  }
  return 'just now';
}
