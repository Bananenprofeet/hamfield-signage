import { spawn } from 'node:child_process';
import type { PlaybackProfile } from '@signage/shared';
import { ffmpegPath } from './probe';

export type H264Profile = 'baseline' | 'main' | 'high';

/** A fixed video-quality preset. One per {@link PlaybackProfile}. */
export interface VideoTier {
  /** Cap the output height (preserving aspect ratio). */
  maxHeight: number;
  /** Cap the output frame rate; higher sources are decimated. */
  maxFrameRate: number;
  /** Target average bitrate in kbps. */
  videoBitrateKbps: number;
  /** H.264 profile; lower = more broadly decodable. */
  profile: H264Profile;
}

/**
 * The per-device encoding tiers. Each video is transcoded into the tiers in use
 * by the fleet and a device is served the one its hardware can decode smoothly.
 * Keep this the single source of truth for the tier parameters.
 */
export const VIDEO_TIERS: Record<PlaybackProfile, VideoTier> = {
  high: { maxHeight: 1080, maxFrameRate: 60, videoBitrateKbps: 9000, profile: 'high' },
  standard: { maxHeight: 1080, maxFrameRate: 30, videoBitrateKbps: 6000, profile: 'high' },
  light: { maxHeight: 720, maxFrameRate: 30, videoBitrateKbps: 2500, profile: 'main' },
};

/**
 * Turns a tier into {@link buildTranscodeArgs} options for a given input/output.
 * `sourceFrameRate` comes from the probe so the fps cap only decimates sources
 * above the cap.
 */
export function tierTranscodeOptions(
  tier: VideoTier,
  io: { inputPath: string; outputPath: string; sourceFrameRate?: number | null },
): TranscodeOptions {
  return {
    inputPath: io.inputPath,
    outputPath: io.outputPath,
    maxHeight: tier.maxHeight,
    videoBitrateKbps: tier.videoBitrateKbps,
    maxFrameRate: tier.maxFrameRate,
    sourceFrameRate: io.sourceFrameRate,
    profile: tier.profile,
  };
}

export interface TranscodeOptions {
  inputPath: string;
  outputPath: string;
  maxHeight: number;
  videoBitrateKbps: number;
  /**
   * Cap the output frame rate. Sources above this are decimated; sources at or
   * below it are left untouched (pass the source fps as `sourceFrameRate`). A
   * stream's H.264 level must match its actual fps — an uncapped 50/60fps clip
   * encoded at a 30fps level is exactly what makes hardware decoders (e.g. the
   * Raspberry Pi) reject the stream and show a white frame.
   */
  maxFrameRate?: number;
  /** Source fps from the probe; used to decide whether the fps cap applies. */
  sourceFrameRate?: number | null;
  /** H.264 profile. Lower = more broadly decodable (default 'high'). */
  profile?: H264Profile;
  /** Mute output entirely (signage default keeps the AAC track but players mute). */
  stripAudio?: boolean;
}

/**
 * Builds the ffmpeg argument list that normalizes any input video into a
 * signage-safe MP4: H.264 (profile per tier), yuv420p, AAC audio, +faststart so
 * playback can begin before the whole file is read, even dimensions (required by
 * H.264), capped height, capped frame rate and capped bitrate. The H.264 level
 * is left for x264 to compute from the (capped) resolution/fps/bitrate so the
 * signalled level always matches the actual stream.
 */
export function buildTranscodeArgs(opts: TranscodeOptions): string[] {
  // Cap height while preserving aspect ratio; -2 keeps width even.
  const filters = [`scale=-2:'min(${opts.maxHeight},ih)'`];
  if (
    opts.maxFrameRate &&
    (opts.sourceFrameRate == null || opts.sourceFrameRate > opts.maxFrameRate)
  ) {
    filters.push(`fps=${opts.maxFrameRate}`);
  }

  const args = [
    '-y',
    '-i',
    opts.inputPath,
    '-vf',
    filters.join(','),
    '-c:v',
    'libx264',
    '-profile:v',
    opts.profile ?? 'high',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'medium',
    '-b:v',
    `${opts.videoBitrateKbps}k`,
    '-maxrate',
    `${Math.round(opts.videoBitrateKbps * 1.5)}k`,
    '-bufsize',
    `${opts.videoBitrateKbps * 2}k`,
    '-movflags',
    '+faststart',
  ];
  if (opts.stripAudio) {
    args.push('-an');
  } else {
    args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2');
  }
  args.push('-f', 'mp4', opts.outputPath);
  return args;
}

export interface ThumbnailOptions {
  inputPath: string;
  outputPath: string;
  maxDimension: number;
  /** For videos: seek position in seconds for the frame grab. */
  seekSeconds?: number;
  isVideo: boolean;
}

export function buildThumbnailArgs(opts: ThumbnailOptions): string[] {
  const scale = `scale='min(${opts.maxDimension},iw)':'min(${opts.maxDimension},ih)':force_original_aspect_ratio=decrease`;
  if (opts.isVideo) {
    return [
      '-y',
      '-ss',
      String(opts.seekSeconds ?? 1),
      '-i',
      opts.inputPath,
      '-frames:v',
      '1',
      '-vf',
      scale,
      '-q:v',
      '4',
      opts.outputPath,
    ];
  }
  return ['-y', '-i', opts.inputPath, '-vf', scale, '-q:v', '4', opts.outputPath];
}

/** Runs ffmpeg with the given args, rejecting with stderr tail on failure. */
export function runFfmpeg(args: string[], timeoutMs = 30 * 60 * 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`ffmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}
