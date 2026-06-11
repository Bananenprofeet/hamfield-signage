import type { MediaOrientation } from '@signage/shared';

/**
 * Classifies media by its pixel dimensions.
 * Rotation metadata must already be applied (ffprobe reports rotated
 * dimensions via side_data; see probe.ts which normalizes this).
 */
export function classifyOrientation(width: number, height: number): MediaOrientation {
  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid dimensions: ${width}x${height}`);
  }
  if (width === height) return 'square';
  return width > height ? 'landscape' : 'portrait';
}

/**
 * Applies a rotation (degrees, from video metadata) to raw dimensions.
 * 90/270 degree rotations swap width and height.
 */
export function applyRotation(
  width: number,
  height: number,
  rotationDegrees: number,
): { width: number; height: number } {
  const normalized = ((rotationDegrees % 360) + 360) % 360;
  if (normalized === 90 || normalized === 270) {
    return { width: height, height: width };
  }
  return { width, height };
}
