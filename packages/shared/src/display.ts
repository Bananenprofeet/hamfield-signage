import { FIT_MODES, POSITION_MODES, type FitMode, type PositionMode } from './enums';
import { DEFAULT_FIT_MODE } from './constants';

// ---------------------------------------------------------------- defaults

/** Platform default background color behind media. */
export const DEFAULT_BACKGROUND_COLOR = '#000000';
/** Platform default media alignment. */
export const DEFAULT_POSITION_MODE: PositionMode = 'center';

// ---------------------------------------------------------------- labels

/** User-facing labels and help text for each fit mode (dashboard). */
export const FIT_MODE_INFO: Record<FitMode, { label: string; description: string }> = {
  contain: {
    label: 'Fit to screen',
    description: 'Shows the whole image/video, keeps aspect ratio, may show bars.',
  },
  cover: {
    label: 'Fill screen / crop',
    description: 'Fills the screen, keeps aspect ratio, crops edges if needed.',
  },
  stretch: {
    label: 'Stretch to screen',
    description: 'Fills the screen but does not keep aspect ratio; may distort.',
  },
  original: {
    label: 'Original size',
    description: 'Actual pixel size, centered. May crop if larger than the screen.',
  },
  scale_down: {
    label: 'Scale down only',
    description: 'Original size if it fits; only shrinks larger media, never upscales.',
  },
};

export const POSITION_MODE_LABELS: Record<PositionMode, string> = {
  center: 'Center',
  top: 'Top',
  bottom: 'Bottom',
  left: 'Left',
  right: 'Right',
  top_left: 'Top left',
  top_right: 'Top right',
  bottom_left: 'Bottom left',
  bottom_right: 'Bottom right',
};

// ---------------------------------------------------------------- validation

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** True for `#RGB` or `#RRGGBB` hex colors only (prevents CSS injection). */
export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_RE.test(value.trim());
}

/** Normalizes a valid hex color to lowercase `#rrggbb`, or null if invalid. */
export function normalizeHexColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (!HEX_COLOR_RE.test(v)) return null;
  if (v.length === 4) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  }
  return v;
}

export function isFitMode(value: unknown): value is FitMode {
  return typeof value === 'string' && (FIT_MODES as readonly string[]).includes(value);
}

export function isPositionMode(value: unknown): value is PositionMode {
  return typeof value === 'string' && (POSITION_MODES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------- resolution

export interface DisplaySettings {
  fitMode: FitMode;
  backgroundColor: string;
  positionMode: PositionMode;
}

/** Item-level (may be unset) display settings. */
export interface DisplayOverrides {
  fitMode?: FitMode | null;
  backgroundColor?: string | null;
  positionMode?: PositionMode | null;
}

/** Playlist-level (may be unset) display defaults. */
export interface DisplayDefaults {
  defaultFitMode?: FitMode | null;
  defaultBackgroundColor?: string | null;
  defaultPositionMode?: PositionMode | null;
}

/**
 * Resolves the effective display settings for one item.
 * Precedence: item override → playlist default → platform default
 * (contain / #000000 / center). Invalid values are ignored (fall through).
 *
 * This is the single source of truth used by the sync manifest builder, the
 * dashboard resolved-preview and the device agent, so the precedence rules
 * never diverge between backend and device.
 */
export function resolveDisplaySettings(
  item?: DisplayOverrides | null,
  defaults?: DisplayDefaults | null,
): DisplaySettings {
  const fitMode =
    (isFitMode(item?.fitMode) ? item?.fitMode : undefined) ??
    (isFitMode(defaults?.defaultFitMode) ? defaults?.defaultFitMode : undefined) ??
    DEFAULT_FIT_MODE;

  const backgroundColor =
    (item?.backgroundColor && isValidHexColor(item.backgroundColor)
      ? normalizeHexColor(item.backgroundColor)!
      : undefined) ??
    (defaults?.defaultBackgroundColor && isValidHexColor(defaults.defaultBackgroundColor)
      ? normalizeHexColor(defaults.defaultBackgroundColor)!
      : undefined) ??
    DEFAULT_BACKGROUND_COLOR;

  const positionMode =
    (isPositionMode(item?.positionMode) ? item?.positionMode : undefined) ??
    (isPositionMode(defaults?.defaultPositionMode) ? defaults?.defaultPositionMode : undefined) ??
    DEFAULT_POSITION_MODE;

  return { fitMode, backgroundColor, positionMode };
}

/** Maps a position mode to a CSS `object-position` / alignment value. */
export function cssObjectPosition(position: PositionMode): string {
  switch (position) {
    case 'center':
      return 'center center';
    case 'top':
      return 'center top';
    case 'bottom':
      return 'center bottom';
    case 'left':
      return 'left center';
    case 'right':
      return 'right center';
    case 'top_left':
      return 'left top';
    case 'top_right':
      return 'right top';
    case 'bottom_left':
      return 'left bottom';
    case 'bottom_right':
      return 'right bottom';
  }
}

/** Fl/justify pair for placing an absolutely-sized element (original/scale_down). */
export function flexAlignment(position: PositionMode): { justify: string; align: string } {
  const x = position.includes('left')
    ? 'flex-start'
    : position.includes('right')
      ? 'flex-end'
      : 'center';
  const y = position.includes('top')
    ? 'flex-start'
    : position.includes('bottom')
      ? 'flex-end'
      : 'center';
  return { justify: x, align: y };
}
