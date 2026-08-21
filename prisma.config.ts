// Prisma 7 config — the Prisma CLI (generate/migrate/studio) no longer
// auto-loads .env or reads datasource.url from schema.prisma; both moved
// here. The app's own server process still uses Node's native
// `--env-file=.env` (see package.json scripts) — dotenv is only for this
// CLI-only entry point.
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
