import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, stat, unlink, readFile, writeFile} from 'node:fs/promises';
import { join } from 'node:path';
import { ZipArchive } from 'archiver';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../lib/env.js';
import { UPLOADS_DIR } from '../lib/uploads.js';
import { settingsService } from './settings.service.js';

const execFileAsync = promisify(execFile);
const BACKUP_DIR = join(process.cwd(), 'backups');

export interface BackupFile {
  file: string;
  sizeBytes: number;
  createdAt: string;
}

// "Active theme" bundling from the source doesn't have a direct 2.0 analog:
// 1.9.44's theme is a filesystem export; 2.0's "theme" is the Appearance
// settings row, already inside the pg_dump this manifest sits next to — a
// separate theme bundle would just be duplicating data the SQL dump already
// has. What 2.0 genuinely has that the DB dump doesn't cover is uploads/
// (real files on disk), so that's what gets bundled alongside the dump.
interface Manifest {
  version: string;
  createdAt: string;
  database: 'sql-dump';
  uploadsIncluded: boolean;
}

function zipArchive(sqlPath: string, manifest: Manifest, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(output);
    archive.file(sqlPath, { name: 'database.sql' });
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    archive.directory(UPLOADS_DIR, 'uploads');
    void archive.finalize();
  });
}

async function uploadToS3(filepath: string, filename: string): Promise<void> {
  const s = await settingsService.getBackupSettings();
  if (s.destination !== 's3' || !s.s3Bucket || !s.s3AccessKey || !s.s3SecretKey) return;
  const client = new S3Client({
    region: s.s3Region || 'us-east-1',
    endpoint: s.s3Endpoint || undefined,
    credentials: { accessKeyId: s.s3AccessKey, secretAccessKey: s.s3SecretKey },
  });
  const body = await readFile(filepath);
  const key = s.s3Prefix ? `${s.s3Prefix.replace(/\/+$/, '')}/${filename}` : filename;
  await client.send(new PutObjectCommand({ Bucket: s.s3Bucket, Key: key, Body: body, ContentType: 'application/zip' }));
}

// Real pg_dump-based backup — not simulated.
//
// The host does not necessarily have PostgreSQL client tools: on the dev
// machine this was built for, Postgres runs in Docker and the host PATH has no
// pg_dump at all, which meant backups could never complete — manual OR
// scheduled. So the container is tried as a second route before giving up:
// the same pg_dump, reached through `docker exec`, dumping over the container's
// own loopback rather than the host's.
type DumpRunner = { label: string; run: (args: string[]) => Promise<unknown> };

// Overridable for a differently-named container without a schema change.
const PG_CONTAINER = process.env.BACKUP_PG_CONTAINER ?? 'therum-cms-pg';

async function resolveDumpRunner(): Promise<DumpRunner | null> {
  try {
    await execFileAsync('pg_dump', ['--version']);
    return { label: 'host pg_dump', run: (args) => execFileAsync('pg_dump', args) };
  } catch {
    // fall through to Docker
  }
  try {
    await execFileAsync('docker', ['exec', PG_CONTAINER, 'pg_dump', '--version']);
    return {
      label: `docker exec ${PG_CONTAINER} pg_dump`,
      // -f would write INSIDE the container; dump to stdout and capture it.
      run: (args) => execFileAsync('docker', ['exec', PG_CONTAINER, 'pg_dump', ...args], { maxBuffer: 512 * 1024 * 1024 }),
    };
  } catch {
    return null;
  }
}

export const backupService = {
  async runNow(): Promise<BackupFile> {
    const runner = await resolveDumpRunner();
    if (!runner) {
      throw new Error(
        'pg_dump isn’t available — install the PostgreSQL client tools, or run Postgres in a Docker container named ' +
          `"${PG_CONTAINER}" so backups can use the one inside it.`,
      );
    }

    await mkdir(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sqlPath = join(BACKUP_DIR, `.tmp-${stamp}.sql`);
    const filename = `therum-cms-${stamp}.zip`;
    const zipPath = join(BACKUP_DIR, filename);

    // DATABASE_URL is Prisma's, and carries Prisma-only query parameters
    // (?schema=, ?connection_limit=…) that pg_dump rejects outright with
    // "invalid URI query parameter". Strip the query before handing it over.
    const bare = env.DATABASE_URL.split('?')[0]!;
    // Inside the container the database is on its own loopback, not the host
    // port the app connects through — rewrite the host so the dump resolves.
    const dumpUrl = runner.label.startsWith('docker')
      ? bare.replace(/@[^/:]+(:\d+)?/, '@127.0.0.1:5432')
      : bare;
    const out = await runner.run([dumpUrl]);
    await writeFile(sqlPath, (out as { stdout: string }).stdout);
    const manifest: Manifest = { version: '2.0.0', createdAt: new Date().toISOString(), database: 'sql-dump', uploadsIncluded: true };
    await zipArchive(sqlPath, manifest, zipPath);
    await unlink(sqlPath).catch(() => {});

    await uploadToS3(zipPath, filename).catch((e) => {
      // S3 delivery failing doesn't invalidate the local backup that just
      // succeeded — surfaced as a thrown error only if there's no local
      // copy to fall back on, which can't happen here (zip already exists).
      throw new Error(`Backup saved locally, but S3 upload failed: ${e instanceof Error ? e.message : String(e)}`);
    });

    const stats = await stat(zipPath);
    return { file: filename, sizeBytes: stats.size, createdAt: new Date().toISOString() };
  },

  async list(): Promise<BackupFile[]> {
    let names: string[];
    try {
      names = await readdir(BACKUP_DIR);
    } catch {
      return [];
    }
    const files = await Promise.all(
      names
        .filter((n) => n.endsWith('.zip'))
        .map(async (n) => {
          const s = await stat(join(BACKUP_DIR, n));
          return { file: n, sizeBytes: s.size, createdAt: s.mtime.toISOString() };
        }),
    );
    return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);
  },
};
