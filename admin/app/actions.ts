'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiSend, apiBase, authToken } from '../lib/api';

// Login/setup/logout are Route Handlers (app/api/auth/*), not Server Actions
// — see LoginScreen.tsx for why (dev-server restarts invalidate Server Action
// IDs baked into an already-loaded page, not plain HTTP routes).

export async function createProduct(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  const price = Math.round(Number(formData.get('price') ?? 0) * 100);
  if (!name) return;
  await apiSend('POST', '/api/products', { name, status: 'active', variants: [{ price: Number.isFinite(price) ? price : 0 }] });
  revalidatePath('/products');
}

export async function transitionOrder(id: string, status: string): Promise<void> {
  await apiSend('POST', `/api/orders/${id}/transition`, { status });
  revalidatePath('/orders');
}

export async function toggleExtension(id: string, enabled: boolean): Promise<void> {
  await apiSend('PATCH', `/api/extensions/${id}`, { enabled });
  revalidatePath('/extensions');
}

export async function createContent(formData: FormData): Promise<void> {
  const title = String(formData.get('title') ?? '').trim();
  const type = String(formData.get('type') ?? 'page');
  if (!title) return;
  await apiSend('POST', '/api/content', { title, type });
  revalidatePath('/pages');
  revalidatePath('/posts');
  revalidatePath('/content');
}

export async function setContentStatus(id: string, status: 'published' | 'draft'): Promise<void> {
  await apiSend('POST', `/api/content/${id}/${status === 'published' ? 'publish' : 'unpublish'}`, {});
  revalidatePath('/pages');
  revalidatePath('/posts');
  revalidatePath('/content');
}

export async function setEdition(edition: string): Promise<void> {
  await apiSend('PATCH', '/api/edition', { edition });
  revalidatePath('/studio');
}

export async function toggleFoundation(id: string, enabled: boolean): Promise<void> {
  await apiSend('PATCH', `/api/foundations/${id}`, { enabled });
  revalidatePath('/studio');
}

export async function toggleStudioApp(id: string, enabled: boolean): Promise<void> {
  await apiSend('PATCH', `/api/studio-apps/${id}`, { enabled });
  revalidatePath('/studio');
}

export async function toggleCapability(id: string, enabled: boolean): Promise<void> {
  await apiSend('PATCH', `/api/capabilities/${id}`, { enabled });
  revalidatePath('/studio');
}

export async function selectProvider(id: string, provider: string): Promise<void> {
  await apiSend('PATCH', `/api/capabilities/${id}`, { provider });
  revalidatePath('/studio');
}

// Post-setup onboarding wizard (edition → connections → branding → finish).
// Each step-change redirects back to /onboarding itself rather than
// revalidating, so the page always re-fetches the freshly-saved step server-
// side — same reasoning as the rest of this file, plain Route-Handler-style
// mutations, no client state to keep in sync.
export async function onboardingSetEdition(edition: string): Promise<void> {
  await apiSend('PATCH', '/api/edition', { edition });
  await apiSend('PATCH', '/api/settings/onboarding', { step: 'connections' });
  redirect('/onboarding');
}

export async function onboardingSetStep(step: string): Promise<void> {
  await apiSend('PATCH', '/api/settings/onboarding', { step });
  redirect('/onboarding');
}

// Every field is optional and only patched if actually filled in — leaving
// one blank must not overwrite an existing value (e.g. a site name set
// earlier via Settings) with an empty string.
export async function onboardingSaveBranding(formData: FormData): Promise<void> {
  const siteName = String(formData.get('siteName') ?? '').trim();
  const accent = String(formData.get('accent') ?? '').trim();
  const heading = String(formData.get('heading') ?? '').trim();
  const subhead = String(formData.get('subhead') ?? '').trim();
  const calls: Promise<unknown>[] = [apiSend('PATCH', '/api/settings/onboarding', { step: 'finish' })];
  if (siteName) calls.push(apiSend('PATCH', '/api/settings/seo-defaults', { siteName }));
  if (accent) calls.push(apiSend('PATCH', '/api/settings/appearance', { accent }));
  if (heading || subhead) {
    calls.push(apiSend('PATCH', '/api/settings/login-branding', { ...(heading ? { heading } : {}), ...(subhead ? { subhead } : {}) }));
  }
  await Promise.all(calls);
  redirect('/onboarding');
}

// Shared by "Skip setup" (available from any step) and the Finish step's
// own "Go to dashboard" button — both mean the same thing: stop showing the
// dashboard's resume banner. Skipping mid-flow still lands on 'finish' so a
// later, deliberate revisit to /onboarding shows the finish screen instead
// of silently restarting at 'edition'.
export async function onboardingComplete(): Promise<void> {
  await apiSend('PATCH', '/api/settings/onboarding', { step: 'finish', completed: true });
  redirect('/');
}

// Dashboard card move/resize and Appearance save are Route Handlers
// (admin/app/api/dashboard-layout/*, admin/app/api/settings/appearance),
// not Server Actions here — same reason as the auth routes above: hit
// "Invalid Server Actions request" live testing this exact feature the
// first time the dev server restarted after these were written.

// ── Bricks Bridge ────────────────────────────────────────────────────────
// Install/toggle/remove the Bricks core theme and its addons. The zip is
// forwarded to the API untouched — the backend unpacks and registers it.
export async function installBricksZip(formData: FormData): Promise<void> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return;
  const body = new FormData();
  body.append('file', file, file.name);
  const res = await fetch(`${apiBase()}/api/bricks/addons`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await authToken()}` },
    body,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Install failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  revalidatePath('/bricks');
}

export async function toggleBricksAddon(slug: string, enabled: boolean): Promise<void> {
  await apiSend('PATCH', `/api/bricks/addons/${slug}`, { enabled });
  revalidatePath('/bricks');
}

export async function removeBricksAddon(slug: string): Promise<void> {
  await apiSend('DELETE', `/api/bricks/addons/${slug}`);
  revalidatePath('/bricks');
}

// ── Product Catalog: categories and tags ────────────────────────────────
//
// These had no UI at all — a category could only be ticked from inside a
// single product, so there was no way to create one, rename it, move it, or
// see the tree. Every action revalidates BOTH the manager and the product
// list, because renaming or re-parenting a category changes what the product
// rows say about themselves.

function catalogRevalidate(): void {
  revalidatePath('/products/categories');
  revalidatePath('/products/tags');
  revalidatePath('/products');
}

export async function createCategory(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;
  const slug = String(formData.get('slug') ?? '').trim();
  const parentId = String(formData.get('parentId') ?? '').trim();
  await apiSend('POST', '/api/catalog/categories', {
    name,
    ...(slug ? { slug } : {}),
    // '' means top level. Sent as null rather than omitted so the intent is
    // explicit on the wire.
    parentId: parentId || null,
  });
  catalogRevalidate();
}

export async function updateCategory(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return;
  const name = String(formData.get('name') ?? '').trim();
  const slug = String(formData.get('slug') ?? '').trim();
  const parentRaw = formData.get('parentId');
  const patch: Record<string, unknown> = {};
  if (name) patch.name = name;
  if (slug) patch.slug = slug;
  // Only sent when the field was actually present, so a rename cannot
  // accidentally re-root a category by omitting it.
  if (parentRaw !== null) patch.parentId = String(parentRaw).trim() || null;
  if (!Object.keys(patch).length) return;
  await apiSend('PATCH', `/api/catalog/categories/${id}`, patch);
  catalogRevalidate();
}

export async function deleteCategory(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return;
  // Children re-root rather than disappearing (onDelete: SetNull), and the
  // products simply lose the link — nothing is deleted with it.
  await apiSend('DELETE', `/api/catalog/categories/${id}`);
  catalogRevalidate();
}

export async function createTag(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;
  const slug = String(formData.get('slug') ?? '').trim();
  await apiSend('POST', '/api/catalog/tags', { name, ...(slug ? { slug } : {}) });
  catalogRevalidate();
}

export async function deleteTag(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return;
  await apiSend('DELETE', `/api/catalog/tags/${id}`);
  catalogRevalidate();
}
