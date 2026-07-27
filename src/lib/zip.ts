import { inflateRawSync } from 'node:zlib';

// Minimal, dependency-free ZIP reader — enough to install a Bricks theme or
// addon plugin zip. Reads the central directory (the authoritative index)
// rather than scanning local headers, so it handles archives with prepended
// data and gives us the real entry list up front.
//
// Supported compression: stored (0) and deflate (8) — what every real .zip
// from WordPress/ThemeForest uses. Anything else throws by name so the
// failure is legible instead of silently producing garbage.

export interface ZipEntry {
  name: string;
  size: number;
  /** Directory entries carry no data and are skipped by extractAll(). */
  isDirectory: boolean;
  read(): Buffer;
}

const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const CD_SIG = 0x02014b50;

function findEocd(buf: Buffer): number {
  // EOCD is at the very end unless there's a zip comment; scan back over the
  // max comment size (64K) + the 22-byte record.
  const min = Math.max(0, buf.length - 0x10000 - 22);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error('Not a ZIP archive (no end-of-central-directory record).');
}

export function readZip(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf);
  let entryCount = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  // ZIP64: the 32-bit fields are saturated and the real values live in the
  // ZIP64 EOCD record pointed at by the locator just before the EOCD.
  if (cdOffset === 0xffffffff || entryCount === 0xffff) {
    const loc = eocd - 20;
    if (loc >= 0 && buf.readUInt32LE(loc) === EOCD64_LOCATOR_SIG) {
      const z64 = Number(buf.readBigUInt64LE(loc + 8));
      entryCount = Number(buf.readBigUInt64LE(z64 + 32));
      cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
    }
  }

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CD_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');

    entries.push({
      name,
      size: uncompressedSize,
      isDirectory: name.endsWith('/'),
      read(): Buffer {
        // Local header lengths can differ from the central ones — always
        // re-read them here to find where the data actually starts.
        const lNameLen = buf.readUInt16LE(localOffset + 26);
        const lExtraLen = buf.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + lNameLen + lExtraLen;
        const raw = buf.subarray(start, start + compressedSize);
        if (method === 0) return Buffer.from(raw);
        if (method === 8) return inflateRawSync(raw);
        throw new Error(`Unsupported ZIP compression method ${method} for "${name}".`);
      },
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Reject absolute paths and ../ traversal — a zip is untrusted input. */
export function safeJoinName(name: string): string | null {
  const clean = name.replace(/\\/g, '/');
  if (clean.startsWith('/') || /^[a-zA-Z]:/.test(clean)) return null;
  if (clean.split('/').some((seg) => seg === '..')) return null;
  return clean;
}
