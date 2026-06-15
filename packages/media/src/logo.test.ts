import { describe, expect, it } from 'vitest';
import { ORG_LOGO_MAX_BYTES } from '@signage/shared';
import { detectRasterLogoMime, isSafeSvg, looksLikeSvg, validateLogoBuffer } from './logo';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const svg = (inner: string) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`);

describe('detectRasterLogoMime', () => {
  it('detects PNG by magic bytes', () => {
    expect(detectRasterLogoMime(PNG_HEADER)).toBe('image/png');
  });
  it('detects JPEG by magic bytes', () => {
    expect(detectRasterLogoMime(JPEG_HEADER)).toBe('image/jpeg');
  });
  it('returns null for non-raster content', () => {
    expect(detectRasterLogoMime(svg('<rect/>'))).toBeNull();
    expect(detectRasterLogoMime(Buffer.from('hello'))).toBeNull();
  });
});

describe('looksLikeSvg', () => {
  it('recognizes an svg document', () => {
    expect(looksLikeSvg(svg('<rect/>'))).toBe(true);
  });
  it('handles a UTF-8 BOM prefix', () => {
    expect(looksLikeSvg(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), svg('<g/>')]))).toBe(true);
  });
  it('rejects non-svg', () => {
    expect(looksLikeSvg(PNG_HEADER)).toBe(false);
  });
});

describe('isSafeSvg', () => {
  it('accepts a plain svg', () => {
    expect(isSafeSvg(svg('<rect width="10" height="10" fill="red"/>')).safe).toBe(true);
  });
  it('accepts local references', () => {
    expect(isSafeSvg(svg('<use href="#icon"/>')).safe).toBe(true);
  });
  it('rejects <script>', () => {
    expect(isSafeSvg(svg('<script>alert(1)</script>')).safe).toBe(false);
  });
  it('rejects inline event handlers', () => {
    expect(isSafeSvg(svg('<rect onload="x()"/>')).safe).toBe(false);
  });
  it('rejects javascript: URIs', () => {
    expect(isSafeSvg(svg('<a href="javascript:alert(1)">x</a>')).safe).toBe(false);
  });
  it('rejects <foreignObject>', () => {
    expect(isSafeSvg(svg('<foreignObject><body/></foreignObject>')).safe).toBe(false);
  });
  it('rejects external references', () => {
    expect(isSafeSvg(svg('<image href="https://evil.example/x.png"/>')).safe).toBe(false);
  });
  it('rejects entity declarations / DOCTYPE', () => {
    expect(isSafeSvg(Buffer.from('<!DOCTYPE svg [<!ENTITY x "y">]><svg></svg>')).safe).toBe(false);
  });
});

describe('validateLogoBuffer', () => {
  it('accepts PNG', () => {
    expect(validateLogoBuffer(PNG_HEADER)).toEqual({ ok: true, mime: 'image/png', ext: 'png' });
  });
  it('accepts JPEG', () => {
    expect(validateLogoBuffer(JPEG_HEADER)).toEqual({ ok: true, mime: 'image/jpeg', ext: 'jpg' });
  });
  it('accepts a safe SVG', () => {
    expect(validateLogoBuffer(svg('<circle r="5"/>'))).toEqual({
      ok: true,
      mime: 'image/svg+xml',
      ext: 'svg',
    });
  });
  it('rejects an unsafe SVG', () => {
    const result = validateLogoBuffer(svg('<script>alert(1)</script>'));
    expect(result.ok).toBe(false);
  });
  it('rejects an empty file', () => {
    expect(validateLogoBuffer(Buffer.alloc(0))).toEqual({
      ok: false,
      error: 'The uploaded file is empty',
    });
  });
  it('rejects an oversized file', () => {
    const big = Buffer.concat([PNG_HEADER, Buffer.alloc(ORG_LOGO_MAX_BYTES + 1)]);
    expect(validateLogoBuffer(big).ok).toBe(false);
  });
  it('rejects unsupported formats (e.g. gif/webp/text)', () => {
    expect(validateLogoBuffer(Buffer.from('GIF89a....')).ok).toBe(false);
    expect(validateLogoBuffer(Buffer.from('RIFF....WEBP')).ok).toBe(false);
  });
});
