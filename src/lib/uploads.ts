import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

// Local-disk media storage. Served back out at the same /api/uploads/ prefix
// it's registered under in server.ts, so the existing nginx `/api/` proxy
// reaches it with no separate location block needed — the browser only ever
// talks to :10004, same as every other route.
export const UPLOADS_DIR = fileURLToPath(new URL('../../uploads', import.meta.url));
mkdirSync(UPLOADS_DIR, { recursive: true });
