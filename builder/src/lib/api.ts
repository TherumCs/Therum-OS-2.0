export interface ApiVariant {
  id: string;
  sku: string | null;
  price: number;
}

export interface ApiProduct {
  id: string;
  name: string;
  image: string | null;
  variants: ApiVariant[];
}

// Live data binding — the builder renders real products from the running API.
export async function fetchProducts(limit = 12): Promise<ApiProduct[]> {
  const res = await fetch(`/api/products?limit=${limit}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = (await res.json()) as { items: ApiProduct[] };
  return data.items;
}

export function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export interface Foundation {
  id: string;
  enabled: boolean;
}

// Which foundations are active — gates which builder paths the toolbar exposes.
export async function fetchFoundations(): Promise<Foundation[]> {
  const res = await fetch('/api/foundations');
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()) as Foundation[];
}

export interface ContentDoc {
  id: string;
  title: string;
  body: unknown;
  bodyFormat: string;
}

// Builder↔Folio: load/save a content item's canvas body. Auth via the edit
// token the admin hands off in the URL.
export async function fetchContent(id: string, token: string): Promise<ContentDoc> {
  const res = await fetch(`/api/content/${id}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`content ${res.status}`);
  return (await res.json()) as ContentDoc;
}

export async function saveContent(id: string, token: string, body: unknown): Promise<void> {
  const res = await fetch(`/api/content/${id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ body, bodyFormat: 'canvas' }),
  });
  if (!res.ok) throw new Error(`save ${res.status}`);
}
