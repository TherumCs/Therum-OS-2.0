import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from './env.js';

// Prisma 7 requires a driver adapter for every database — the old
// datasources-object / bare `new PrismaClient()` construction no longer
// connects at all. Local dev Postgres (docker-compose) has no SSL, so no
// `ssl` option is passed — add one (see Prisma's v7 upgrade guide's SSL
// section) if this ever points at a server that requires it.
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

// Single cached Prisma client. Explicit dependency, no global leakage.
export const db = new PrismaClient({
  adapter,
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export async function disconnectDb(): Promise<void> {
  await db.$disconnect();
}
