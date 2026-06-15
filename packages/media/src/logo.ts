import { ORG_LOGO_MAX_BYTES } from '@signage/shared';

export interface LogoValidationOk {
  ok: true;
  mime: 'image/svg+xml' | 'image/png' | 'image/jpeg';
  ext: 'svg' | 'png' | 'jpg';
}
export interface LogoValidationError {
  ok: false;
  error: string;
}
export type LogoValidationResult = LogoValidationOk | LogoValidationError;

/**
 * Detects a raster logo type from magic bytes. Returns null for anything that
 * is not a PNG or JPEG (SVG is handled separately because it is text).
 */
export function detectRasterLogoMime(buffer: Buffer): 'image/png' | 'image/jpeg' | null {
  if (buffer.length < 4) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  return null;
}

/** Returns true if the buffer looks like an SVG document (XML with an <svg> root). */
export function looksLikeSvg(buffer: Buffer): boolean {
  // SVG is text; only scan the head. Strip a leading UTF-8 BOM if present.
  let head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8');
  if (head.charCodeAt(0) === 0xfeff) head = head.slice(1);
  const lower = head.toLowerCase();
  return lower.includes('<svg');
}

const UNSAFE_SVG_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /<script[\s>]/i, reason: '<script> elements are not allowed' },
  { pattern: /<foreignobject[\s>]/i, reason: '<foreignObject> is not allowed' },
  { pattern: /<!entity/i, reason: 'entity declarations are not allowed' },
  { pattern: /<!doctype/i, reason: 'DOCTYPE declarations are not allowed' },
  { pattern: /javascript:/i, reason: 'javascript: URIs are not allowed' },
  { pattern: /\son\w+\s*=/i, reason: 'inline event handlers (on*) are not allowed' },
  // External references (remote images/stylesheets/use). Local refs (#id) are fine.
  {
    pattern: /(?:xlink:href|href)\s*=\s*["']\s*(?:https?:)?\/\//i,
    reason: 'external references are not allowed',
  },
  {
    pattern: /<use[^>]+href\s*=\s*["']\s*(?:https?:)?\/\//i,
    reason: 'external <use> references are not allowed',
  },
];

/**
 * Conservative allow-by-rejection SVG check. We never inline SVG into the DOM
 * (logos render via <img src>), but we still reject scriptable / network-active
 * SVGs as defence in depth. The full file is scanned, not just the head.
 */
export function isSafeSvg(buffer: Buffer): { safe: boolean; reason?: string } {
  const text = buffer.toString('utf8');
  if (!text.toLowerCase().includes('<svg'))
    return { safe: false, reason: 'not a valid SVG document' };
  for (const { pattern, reason } of UNSAFE_SVG_PATTERNS) {
    if (pattern.test(text)) return { safe: false, reason };
  }
  return { safe: true };
}

/**
 * Validates an organization logo upload by content (never by client MIME type
 * or extension). Enforces the supported formats (SVG/PNG/JPG/JPEG), size limit
 * and SVG safety rules.
 */
export function validateLogoBuffer(buffer: Buffer): LogoValidationResult {
  if (buffer.length === 0) return { ok: false, error: 'The uploaded file is empty' };
  if (buffer.length > ORG_LOGO_MAX_BYTES) {
    return { ok: false, error: `Logo exceeds the maximum size of ${ORG_LOGO_MAX_BYTES} bytes` };
  }

  const raster = detectRasterLogoMime(buffer);
  if (raster === 'image/png') return { ok: true, mime: 'image/png', ext: 'png' };
  if (raster === 'image/jpeg') return { ok: true, mime: 'image/jpeg', ext: 'jpg' };

  if (looksLikeSvg(buffer)) {
    const svg = isSafeSvg(buffer);
    if (!svg.safe) return { ok: false, error: `Unsafe SVG: ${svg.reason}` };
    return { ok: true, mime: 'image/svg+xml', ext: 'svg' };
  }

  return { ok: false, error: 'Unsupported logo format — use SVG, PNG, JPG or JPEG' };
}
