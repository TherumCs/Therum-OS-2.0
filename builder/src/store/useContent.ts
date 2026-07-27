import { create } from 'zustand';
import { fetchContent, saveContent } from '../lib/api.js';
import { useCanvas } from './useCanvas.js';
import type { CanvasNode } from '../lib/builder-types.js';

function freshRoot(): CanvasNode {
  return { id: 'root', type: 'section', props: { background: '#f8fafc', padding: 40, maxWidth: 1100 }, children: [] };
}

function asCanvasNode(body: unknown): CanvasNode {
  if (body && typeof body === 'object' && typeof (body as { type?: unknown }).type === 'string' && Array.isArray((body as { children?: unknown }).children)) {
    return body as CanvasNode;
  }
  return freshRoot();
}

type Status = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

interface ContentState {
  id: string | null;
  token: string | null;
  title: string;
  status: Status;
  message: string;
  init: () => void;
  save: () => Promise<void>;
}

export const useContent = create<ContentState>((set, get) => ({
  id: null,
  token: null,
  title: '',
  status: 'idle',
  message: '',

  init: () => {
    const url = new URL(window.location.href);
    const id = url.searchParams.get('content');
    const token = url.searchParams.get('token');
    if (!id || !token) return;
    set({ id, token, status: 'loading' });
    fetchContent(id, token)
      .then((doc) => {
        useCanvas.getState().setTree(asCanvasNode(doc.body));
        set({ title: doc.title, status: 'idle', message: '' });
      })
      .catch((e: unknown) => set({ status: 'error', message: e instanceof Error ? e.message : String(e) }));
  },

  save: async () => {
    const { id, token } = get();
    if (!id || !token) return;
    set({ status: 'saving', message: '' });
    try {
      await saveContent(id, token, useCanvas.getState().tree);
      set({ status: 'saved', message: 'Saved to Folio' });
      setTimeout(() => {
        if (get().status === 'saved') set({ status: 'idle', message: '' });
      }, 2000);
    } catch (e: unknown) {
      set({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  },
}));
