import { useEffect, useState } from 'react';
import { fetchFoundations } from '../lib/api.js';
import type { BuilderExtension } from './types.js';
import { bricksExtension } from './bricks/index.js';

// Every builder extension, regardless of which foundation gates it. Adding a
// new one (e.g. a future WordPress extension) means writing one module here —
// zero changes to the core Toolbar.
export const EXTENSIONS: BuilderExtension[] = [bricksExtension];

// Resolves which extensions are currently active by checking their gating
// foundation against /api/foundations — the same source of truth Studio uses.
export function useEnabledExtensions(): BuilderExtension[] {
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchFoundations()
      .then((fs) => setEnabledIds(new Set(fs.filter((f) => f.enabled).map((f) => f.id))))
      .catch(() => setEnabledIds(new Set()));
  }, []);

  return EXTENSIONS.filter((ext) => enabledIds.has(ext.foundationId));
}
