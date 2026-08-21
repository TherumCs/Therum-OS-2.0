// The four content-list layouts, kept in a plain module (no 'use client') so
// the server components that read `?view=` can call resolveListView() — a
// helper exported from a client module is only ever a client function, and
// calling it during SSR throws.

export type ListView = 'card' | 'hero' | 'list' | 'grid';

export const LIST_VIEW_KEYS: ListView[] = ['card', 'hero', 'list', 'grid'];

export const DEFAULT_LIST_VIEW: ListView = 'card';

export function resolveListView(value: string | undefined): ListView {
  return LIST_VIEW_KEYS.includes(value as ListView) ? (value as ListView) : DEFAULT_LIST_VIEW;
}
