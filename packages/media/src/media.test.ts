import { describe, expect, it } from 'vitest';
import { applyRotation, classifyOrientation } from './orientation';
import { interpretProbeOutput } from './probe';
import { buildTranscodeArgs } from './transcode';
import { fileExtension, mediaTypeForMime, sanitizeFilename, sniffMimeType } from './validation';

describe('buildTranscodeArgs frame-rate cap', () => {
  const base = { inputPath: 'in', outputPath: 'out', maxHeight: 1080, videoBitrateKbps: 6000 };
  const vf = (opts: Parameters<typeof buildTranscodeArgs>[0]) => {
    const args = buildTranscodeArgs(opts);
    return args[args.indexOf('-vf') + 1];
  };

  it('decimates sources above the cap', () => {
    expect(vf({ ...base, maxFrameRate: 30, sourceFrameRate: 60 })).toContain('fps=30');
  });
  it('leaves sources at or below the cap untouched', () => {
    expect(vf({ ...base, maxFrameRate: 30, sourceFrameRate: 25 })).not.toContain('fps=');
  });
  it('applies the cap when the source fps is unknown (safe default)', () => {
    expect(vf({ ...base, maxFrameRate: 30, sourceFrameRate: null })).toContain('fps=30');
  });
  it('never pins an explicit H.264 level (x264 computes it from the stream)', () => {
    expect(buildTranscodeArgs({ ...base, maxFrameRate: 30 })).not.toContain('-level');
  });
  it('honours the profile (lighter tier for weak players)', () => {
    const args = buildTranscodeArgs({ ...base, profile: 'main' });
    expect(args[args.indexOf('-profile:v') + 1]).toBe('main');
  });
});

describe('classifyOrientation', () => {
  it('classifies landscape', () => {
    expect(classifyOrientation(1920, 1080)).toBe('landscape');
  });
  it('classifies portrait', () => {
    expect(classifyOrientation(1080, 1920)).toBe('portrait');
  });
  it('classifies square', () => {
    expect(classifyOrientation(1080, 1080)).toBe('square');
  });
  it('rejects invalid dimensions', () => {
    expect(() => classifyOrientation(0, 100)).toThrow();
    expect(() => classifyOrientation(100, -5)).toThrow();
  });
});

describe('applyRotation', () => {
  it('swaps dimensions for 90/270 degrees', () => {
    expect(applyRotation(1920, 1080, 90)).toEqual({ width: 1080, height: 1920 });
    expect(applyRotation(1920, 1080, 270)).toEqual({ width: 1080, height: 1920 });
    expect(applyRotation(1920, 1080, -90)).toEqual({ width: 1080, height: 1920 });
  });
  it('keeps dimensions for 0/180 degrees', () => {
    expect(applyRotation(1920, 1080, 0)).toEqual({ width: 1920, height: 1080 });
    expect(applyRotation(1920, 1080, 180)).toEqual({ width: 1920, height: 1080 });
    expect(applyRotation(1920, 1080, 360)).toEqual({ width: 1920, height: 1080 });
  });
});

describe('interpretProbeOutput', () => {
  it('detects a portrait phone video via rotation side data', () => {
    const result = interpretProbeOutput({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          side_data_list: [{ rotation: -90 }],
        },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
      format: { duration: '12.5', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
    });
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
    expect(result.orientation).toBe('portrait');
    expect(result.durationSeconds).toBeCloseTo(12.5);
    expect(result.videoCodec).toBe('h264');
    expect(result.audioCodec).toBe('aac');
  });

  it('detects a plain landscape video', () => {
    const result = interpretProbeOutput({
      streams: [{ codec_type: 'video', codec_name: 'vp9', width: 1280, height: 720 }],
      format: { duration: '30', format_name: 'webm' },
    });
    expect(result.orientation).toBe('landscape');
    expect(result.audioCodec).toBeNull();
  });

  it('handles images (no duration)', () => {
    const result = interpretProbeOutput({
      streams: [{ codec_type: 'video', codec_name: 'png', width: 800, height: 1200 }],
      format: { format_name: 'png_pipe' },
    });
    expect(result.orientation).toBe('portrait');
    expect(result.durationSeconds).toBeNull();
  });

  it('throws when no video stream exists', () => {
    expect(() =>
      interpretProbeOutput({ streams: [{ codec_type: 'audio', codec_name: 'mp3' }] }),
    ).toThrow(/No decodable/);
  });
});

describe('sniffMimeType', () => {
  const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc(Math.max(0, 32 - b.length))]);

  it('detects JPEG', () => {
    expect(sniffMimeType(pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0])))).toBe('image/jpeg');
  });
  it('detects PNG', () => {
    expect(sniffMimeType(pad(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))).toBe(
      'image/png',
    );
  });
  it('detects WebP', () => {
    const buf = pad(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]));
    expect(sniffMimeType(buf)).toBe('image/webp');
  });
  it('detects MP4', () => {
    const buf = pad(
      Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftyp'), Buffer.from('isom')]),
    );
    expect(sniffMimeType(buf)).toBe('video/mp4');
  });
  it('detects MOV', () => {
    const buf = pad(
      Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftyp'), Buffer.from('qt  ')]),
    );
    expect(sniffMimeType(buf)).toBe('video/quicktime');
  });
  it('detects WebM vs Matroska', () => {
    const webm = Buffer.concat([
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      Buffer.from('....webmB...'),
      Buffer.alloc(16),
    ]);
    expect(sniffMimeType(webm)).toBe('video/webm');
    const mkv = Buffer.concat([
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      Buffer.from('....matroska'),
      Buffer.alloc(16),
    ]);
    expect(sniffMimeType(mkv)).toBe('video/x-matroska');
  });
  it('detects AVI', () => {
    const buf = pad(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('AVI ')]));
    expect(sniffMimeType(buf)).toBe('video/x-msvideo');
  });
  it('rejects unknown content', () => {
    expect(sniffMimeType(pad(Buffer.from('hello world, not a media file')))).toBeNull();
    expect(sniffMimeType(Buffer.from('<?php evil'))).toBeNull();
  });
});

describe('sanitizeFilename', () => {
  it('strips directory components', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Windows\\evil.exe')).toBe('evil.exe');
    expect(sanitizeFilename('/var/tmp/x.png')).toBe('x.png');
  });
  it('collapses path traversal dots', () => {
    expect(sanitizeFilename('a..b.png')).toBe('a.b.png');
  });
  it('replaces unsafe characters', () => {
    expect(sanitizeFilename('my photo (1).jpg')).toBe('my_photo__1_.jpg');
  });
  it('never returns an empty name', () => {
    expect(sanitizeFilename('///')).toBe('file');
    expect(sanitizeFilename('...')).toBe('file');
  });
  it('strips leading dots so files cannot hide or escape', () => {
    expect(sanitizeFilename('.hidden')).toBe('hidden');
  });
});

describe('mediaTypeForMime / fileExtension', () => {
  it('maps mimes to media types', () => {
    expect(mediaTypeForMime('image/png')).toBe('image');
    expect(mediaTypeForMime('video/mp4')).toBe('video');
    expect(mediaTypeForMime('application/pdf')).toBeNull();
  });
  it('extracts extensions', () => {
    expect(fileExtension('movie.final.MP4')).toBe('mp4');
    expect(fileExtension('noext')).toBe('');
  });
});
