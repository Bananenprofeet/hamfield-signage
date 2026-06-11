import type { MediaType } from '@signage/shared';

export const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/x-msvideo',
  'video/webm',
  'video/x-m4v',
  'video/mpeg',
  'video/3gpp',
]);

export const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  webm: 'video/webm',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  '3gp': 'video/3gpp',
};

export function mediaTypeForMime(mime: string): MediaType | null {
  if (ALLOWED_IMAGE_MIMES.has(mime)) return 'image';
  if (ALLOWED_VIDEO_MIMES.has(mime)) return 'video';
  return null;
}

/**
 * Detects the real file type from magic bytes. Never trust the
 * client-provided MIME type or extension alone.
 * Returns null when the signature is not a supported media format.
 */
export function sniffMimeType(buffer: Buffer): string | null {
  if (buffer.length < 16) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  // AVI: "RIFF" .... "AVI "
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'AVI '
  ) {
    return 'video/x-msvideo';
  }

  // MP4 / MOV / M4V: size + "ftyp" at offset 4
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii');
    if (brand.startsWith('qt')) return 'video/quicktime';
    if (brand === 'M4V ' || brand === 'M4VP') return 'video/x-m4v';
    if (brand.startsWith('3gp')) return 'video/3gpp';
    return 'video/mp4';
  }

  // Matroska / WebM: 1A 45 DF A3 (EBML). Distinguishing webm needs DocType scan.
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('latin1');
    return head.includes('webm') ? 'video/webm' : 'video/x-matroska';
  }

  // MPEG-PS / MPEG-1: 00 00 01 BA or 00 00 01 B3
  if (
    buffer[0] === 0x00 &&
    buffer[1] === 0x00 &&
    buffer[2] === 0x01 &&
    (buffer[3] === 0xba || buffer[3] === 0xb3)
  ) {
    return 'video/mpeg';
  }

  return null;
}

function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) out += ch;
  }
  return out;
}

/**
 * Produces a safe filename: strips directories, control characters and
 * path-traversal sequences, collapses unsafe characters to '_'.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, '');
  const cleaned = stripControlChars(base)
    .replace(/\.\.+/g, '.')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^[.-]+/, '');
  const trimmed = cleaned.slice(0, 200);
  return trimmed.length > 0 ? trimmed : 'file';
}

export function fileExtension(filename: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(filename);
  return match ? match[1].toLowerCase() : '';
}
