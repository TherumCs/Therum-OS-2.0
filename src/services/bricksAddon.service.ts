import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { db } from '../lib/db.js';
import { readZip, safeJoinName } from '../lib/zip.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';

// Bricks Bridge — installed-component registry.
//
// The replatform runs Bricks WITHOUT WordPress: 2.0 speaks the Bricks element
// format natively (see lib/bricksAdapter + lib/render fidelity mode). What a
// "install" means here is therefore narrower and honest — we unpack the zip,
// read its WordPress-style header for identity, keep the files on disk, and
// register the component so the Bridge page can show what's present and the
// asset pipeline can pull CSS/JS from it. We do NOT execute any PHP.

export const ADDONS_DIR = fileURLToPath(new URL('../../bricks-addons', import.meta.url));
mkdirSync(ADDONS_DIR, { recursive: true });

const PREFIX = 'bricksaddon:';
const MAX_FILES = 5000;

export type AddonKind = 'core' | 'addon';

export interface AddonManifest {
  kind: AddonKind;
  slug: string;
  title: string;
  description: string;
  author: string;
  uri: string;
  /** Relative dir under ADDONS_DIR where the files live. */
  dir: string;
  files: number;
  bytes: number;
  installedAt: string;
  /** php files are stored but never executed — surfaced so that's explicit. */
  phpFiles: number;
  assets: { css: number; js: number };
}

function headerField(text: string, field: string): string {
  const m = new RegExp(`^[\\s*#/]*${field}\\s*:\\s*(.+)$`, 'im').exec(text);
  return m ? m[1]!.trim().replace(/\s*\*\/\s*$/, '').trim() : '';
}

/**
 * Identify the archive from its WordPress-style header block. A theme carries
 * `Theme Name:` in style.css; a plugin carries `Plugin Name:` in a PHP file.
 * Bricks itself (Theme Name: Bricks) registers as core, everything else as an
 * addon — so uploading advanced-themer.zip and bricks.zip both Just Work.
 */
function identify(entries: ReturnType<typeof readZip>): Omit<AddonManifest, 'dir' | 'files' | 'bytes' | 'installedAt' | 'phpFiles' | 'assets'> {
  const read = (name: string): string => {
    const e = entries.find((x) => x.name.toLowerCase().endsWith(name));
    if (!e || e.isDirectory || e.size > 512 * 1024) return '';
    try {
      return e.read().toString('utf8').slice(0, 8192);
    } catch {
      return '';
    }
  };

  const style = read('style.css');
  const themeName = headerField(style, 'Theme Name');
  if (themeName) {
    return {
      kind: /^bricks$/i.test(themeName) ? 'core' : 'addon',
      slug: themeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      title: themeName,
      description: headerField(style, 'Description'),
      author: headerField(style, 'Author'),
      uri: headerField(style, 'Theme URI'),
    };
  }

  // Plugin: scan the shallowest PHP files for a Plugin Name header.
  const phps = entries
    .filter((e) => !e.isDirectory && e.name.toLowerCase().endsWith('.php') && e.size < 512 * 1024)
    .sort((a, b) => a.name.split('/').length - b.name.split('/').length)
    .slice(0, 25);
  for (const e of phps) {
    let text = '';
    try {
      text = e.read().toString('utf8').slice(0, 8192);
    } catch {
      continue;
    }
    const pluginName = headerField(text, 'Plugin Name');
    if (!pluginName) continue;
    return {
      kind: 'addon',
      slug: pluginName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      title: pluginName,
      description: headerField(text, 'Description'),
      author: headerField(text, 'Author'),
      uri: headerField(text, 'Plugin URI'),
    };
  }
  return { kind: 'addon', slug: '', title: '', description: '', author: '', uri: '' };
}

function versionOf(entries: ReturnType<typeof readZip>): string {
  for (const name of ['style.css', '.php']) {
    const e = entries.find((x) => !x.isDirectory && x.name.toLowerCase().endsWith(name) && x.size < 512 * 1024);
    if (!e) continue;
    try {
      const v = headerField(e.read().toString('utf8').slice(0, 8192), 'Version');
      if (v) return v;
    } catch {
      /* keep looking */
    }
  }
  return '0.0.0';
}

export const bricksAddonService = {
  async list() {
    const rows = await db.extension.findMany({
      where: { name: { startsWith: PREFIX } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      slug: r.name.slice(PREFIX.length),
      version: r.version,
      enabled: r.enabled,
      health: r.health,
      ...(r.manifest as unknown as AddonManifest),
    }));
  },

  /** What the Bridge page header reports. */
  async status() {
    const items = await this.list();
    const core = items.find((i) => i.kind === 'core') ?? null;
    return {
      core,
      addons: items.filter((i) => i.kind !== 'core'),
      // 2.0 renders the Bricks element format natively — true regardless of
      // whether a zip has been uploaded, and the thing that actually matters.
      nativeRenderer: true,
    };
  },

  async install(filename: string, buffer: Buffer) {
    if (!buffer?.length) throw new ValidationError('The uploaded file is empty.', 'file');

    let entries;
    try {
      entries = readZip(buffer);
    } catch (e) {
      throw new ValidationError(e instanceof Error ? e.message : 'Could not read the ZIP archive.', 'file');
    }
    if (!entries.length) throw new ValidationError('That ZIP archive is empty.', 'file');
    if (entries.length > MAX_FILES) throw new ValidationError(`Archive has too many files (${entries.length} > ${MAX_FILES}).`, 'file');

    const ident = identify(entries);
    const fallback = filename.replace(/\.zip$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const slug = ident.slug || fallback || 'addon';
    const title = ident.title || filename.replace(/\.zip$/i, '');
    const version = versionOf(entries);

    // Extract. Path-traversal entries are dropped, not fatal.
    const dir = slug;
    const dest = join(ADDONS_DIR, dir);
    rmSync(dest, { recursive: true, force: true });
    let files = 0;
    let bytes = 0;
    let phpFiles = 0;
    let css = 0;
    let js = 0;
    for (const e of entries) {
      if (e.isDirectory) continue;
      const rel = safeJoinName(e.name);
      if (!rel) continue;
      let data: Buffer;
      try {
        data = e.read();
      } catch {
        continue; // unsupported compression on one file shouldn't sink the install
      }
      const out = join(dest, rel);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, data);
      files++;
      bytes += data.length;
      const lower = rel.toLowerCase();
      if (lower.endsWith('.php')) phpFiles++;
      else if (lower.endsWith('.css')) css++;
      else if (lower.endsWith('.js')) js++;
    }
    if (!files) throw new ValidationError('No usable files found in that archive.', 'file');

    const manifest: AddonManifest = {
      kind: ident.kind,
      slug,
      title,
      description: ident.description,
      author: ident.author,
      uri: ident.uri,
      dir,
      files,
      bytes,
      phpFiles,
      assets: { css, js },
      installedAt: new Date().toISOString(),
    };

    const row = await db.extension.upsert({
      where: { name: PREFIX + slug },
      update: { version, manifest: manifest as unknown as Prisma.InputJsonValue, health: 'ok' },
      create: {
        name: PREFIX + slug,
        version,
        manifest: manifest as unknown as Prisma.InputJsonValue,
        enabled: true,
        health: 'ok',
      },
    });
    return { id: row.id, slug, version, enabled: row.enabled, ...manifest };
  },

  async setEnabled(slug: string, enabled: boolean) {
    const row = await db.extension.findUnique({ where: { name: PREFIX + slug } });
    if (!row) throw new NotFoundError('Component not found', 'slug');
    const updated = await db.extension.update({ where: { name: PREFIX + slug }, data: { enabled } });
    return { id: updated.id, slug, enabled: updated.enabled };
  },

  async remove(slug: string) {
    const row = await db.extension.findUnique({ where: { name: PREFIX + slug } });
    if (!row) throw new NotFoundError('Component not found', 'slug');
    const manifest = row.manifest as unknown as AddonManifest;
    if (manifest?.dir) {
      const dest = join(ADDONS_DIR, manifest.dir);
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    }
    await db.extension.delete({ where: { name: PREFIX + slug } });
    return { slug, removed: true as const };
  },

  /** Concatenated CSS from every enabled component — for the asset pipeline. */
  async collectCss(): Promise<string> {
    const items = await this.list();
    const out: string[] = [];
    for (const it of items) {
      if (!it.enabled || !it.dir) continue;
      const base = join(ADDONS_DIR, it.dir);
      if (!existsSync(base)) continue;
      out.push(`/* ===== ${it.title} ${it.version} ===== */`);
    }
    return out.join('\n');
  },
};

export function readAddonFile(dir: string, rel: string): Buffer | null {
  const safe = safeJoinName(rel);
  if (!safe) return null;
  const p = join(ADDONS_DIR, dir, safe);
  if (!p.startsWith(ADDONS_DIR) || !existsSync(p)) return null;
  return readFileSync(p);
}
