import { extname } from 'node:path';
import { settingsService } from '../services/settings.service.js';
import { ValidationError } from './errors.js';

// Settings > Uploads, enforced.
//
// Every field on that page saved correctly and nothing read any of them: the
// size cap was a hardcoded 50MB in server.ts, the resize bound a hardcoded
// 2560 in imagePipeline.ts, and the six "allow X" toggles were never consulted
// at all — so an install with Documents/Archives/Code switched OFF still
// accepted a .php or .zip without complaint. That is the dangerous kind of
// dead setting: it reads as a restriction and enforces nothing.

export type UploadKind = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'code' | 'other';

// Extension-driven, with mimetype only as a fallback: a browser will happily
// send application/octet-stream for anything, and the extension is what
// actually decides how the file is later served.
const BY_EXTENSION: Record<string, UploadKind> = {};
const register = (kind: UploadKind, exts: string[]): void => {
  for (const e of exts) BY_EXTENSION[e] = kind;
};
register('image', ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg', '.bmp', '.tiff', '.ico', '.heic']);
register('video', ['.mp4', '.mov', '.webm', '.m4v', '.avi', '.mkv', '.ogv']);
register('audio', ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac']);
register('document', ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.csv', '.odt', '.md']);
register('archive', ['.zip', '.tar', '.gz', '.tgz', '.bz2', '.7z', '.rar']);
register('code', ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.php', '.py', '.rb', '.sh', '.bash', '.pl',
  '.json', '.xml', '.yml', '.yaml', '.html', '.htm', '.css', '.scss', '.sql', '.env', '.ini', '.conf']);

export function classifyUpload(filename: string, mimetype: string): UploadKind {
  const byExt = BY_EXTENSION[extname(filename).toLowerCase()];
  if (byExt) return byExt;
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  if (mimetype.startsWith('text/')) return 'document';
  return 'other';
}

export interface UploadPolicy {
  maxBytes: number;
  resizeMaxPx: number;
  stripExif: boolean;
  autoWebp: boolean;
  autoRename: boolean;
}

const ALLOW_FIELD: Record<UploadKind, 'allowImages' | 'allowVideo' | 'allowAudio' | 'allowDocuments' | 'allowArchives' | 'allowCode' | null> = {
  image: 'allowImages',
  video: 'allowVideo',
  audio: 'allowAudio',
  document: 'allowDocuments',
  archive: 'allowArchives',
  code: 'allowCode',
  other: null,
};

const KIND_LABEL: Record<UploadKind, string> = {
  image: 'Images', video: 'Video', audio: 'Audio',
  document: 'Documents', archive: 'Archives', code: 'Code files', other: 'This file type',
};

/**
 * Applies Settings > Uploads to one incoming file. Throws if the file is
 * larger than the configured cap or of a type this install does not accept.
 */
export async function checkUpload(filename: string, mimetype: string, byteLength: number): Promise<UploadPolicy> {
  const u = await settingsService.getUploads();
  const maxBytes = u.maxUploadMb * 1024 * 1024;

  if (byteLength > maxBytes) {
    throw new ValidationError(
      `That file is ${(byteLength / 1024 / 1024).toFixed(1)} MB — this site accepts up to ${u.maxUploadMb} MB. Change the limit under Settings → Uploads.`,
      'file',
    );
  }

  const kind = classifyUpload(filename, mimetype);
  const field = ALLOW_FIELD[kind];
  // An unrecognised type is only allowed where Documents are — the closest
  // "miscellaneous file" bucket. Defaulting it to allowed would make the
  // toggles trivially bypassable by renaming.
  const allowed = field ? u[field] : u.allowDocuments;
  if (!allowed) {
    throw new ValidationError(
      `${KIND_LABEL[kind]} are turned off for this site. Enable them under Settings → Uploads.`,
      'file',
    );
  }

  return {
    maxBytes,
    resizeMaxPx: u.resizeMaxPx,
    stripExif: u.stripExif,
    autoWebp: u.autoWebp,
    autoRename: u.autoRename,
  };
}
