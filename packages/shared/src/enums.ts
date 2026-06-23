/**
 * The shape of the content canvas the audience sees. This is the *logical*
 * orientation and is independent of how the physical panel is mounted — see
 * DEVICE_ROTATIONS for the software compensation applied at render time.
 */
export const DEVICE_ORIENTATIONS = ['landscape', 'portrait'] as const;
export type DeviceOrientation = (typeof DEVICE_ORIENTATIONS)[number];

/**
 * Software rotation (clockwise degrees) the player applies to the stage to
 * compensate for how the panel is physically mounted relative to its native
 * scan-out. Orthogonal to orientation:
 *   - Native 16:9 landscape panel:            orientation landscape, rotation 0
 *   - Native 9:16 portrait panel:             orientation portrait,  rotation 0
 *   - 16:9 panel physically rotated to tall:  orientation portrait,  rotation 90
 *   - Landscape panel mounted upside-down:    orientation landscape, rotation 180
 */
export const DEVICE_ROTATIONS = [0, 90, 180, 270] as const;
export type DeviceRotation = (typeof DEVICE_ROTATIONS)[number];

export const MEDIA_ORIENTATIONS = ['landscape', 'portrait', 'square'] as const;
export type MediaOrientation = (typeof MEDIA_ORIENTATIONS)[number];

export const FIT_MODES = ['contain', 'cover', 'stretch', 'original', 'scale_down'] as const;
export type FitMode = (typeof FIT_MODES)[number];

export const POSITION_MODES = [
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'top_left',
  'top_right',
  'bottom_left',
  'bottom_right',
] as const;
export type PositionMode = (typeof POSITION_MODES)[number];

export const MEDIA_TYPES = ['image', 'video'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const PROCESSING_STATUSES = ['pending', 'processing', 'ready', 'failed'] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export const ORG_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const GLOBAL_ROLES = ['user', 'superadmin'] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

export const ORG_STATUSES = ['active', 'disabled'] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];

export const PLAYBACK_ORDER_MODES = [
  'manual_order',
  'alphabetical',
  'random',
  'random_with_priority_rules',
] as const;
export type PlaybackOrderMode = (typeof PLAYBACK_ORDER_MODES)[number];

export const PLAYLIST_ITEM_TYPES = ['media', 'folder'] as const;
export type PlaylistItemType = (typeof PLAYLIST_ITEM_TYPES)[number];

export const PRIORITY_SELECTION_MODES = ['rotate', 'random'] as const;
export type PrioritySelectionMode = (typeof PRIORITY_SELECTION_MODES)[number];

export const PLAYED_AS_VALUES = ['normal', 'priority'] as const;
export type PlayedAs = (typeof PLAYED_AS_VALUES)[number];

export const COMMAND_TYPES = [
  'restart_player',
  'reboot_device',
  'refresh_content',
  'clear_cache',
  'take_screenshot',
  'identify',
  'set_orientation',
  'set_playlist',
  'update_settings',
  'show_emergency',
  'stop_emergency',
  'send_logs',
  'health_check',
  'software_update',
] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export const COMMAND_STATUSES = [
  'pending',
  'sent',
  'acked',
  'completed',
  'failed',
  'expired',
] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number];

export const SYNC_STATUSES = ['never_synced', 'in_sync', 'syncing', 'error'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const PLAYBACK_EVENT_TYPES = ['start', 'end', 'error', 'skip'] as const;
export type PlaybackEventType = (typeof PLAYBACK_EVENT_TYPES)[number];

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const MEDIA_VARIANT_KINDS = ['original', 'processed', 'fallback', 'thumbnail'] as const;
export type MediaVariantKind = (typeof MEDIA_VARIANT_KINDS)[number];

/** Does the configured content orientation present a portrait-shaped viewport? */
export function isPortraitDeviceOrientation(o: DeviceOrientation): boolean {
  return o === 'portrait';
}

/** Returns the media orientation that best matches a device orientation. */
export function expectedMediaOrientation(o: DeviceOrientation): MediaOrientation {
  return isPortraitDeviceOrientation(o) ? 'portrait' : 'landscape';
}

/** A 90°/270° rotation swaps the stage's width and height. */
export function rotationSwapsAxes(rotation: DeviceRotation): boolean {
  return rotation === 90 || rotation === 270;
}

/** True when a media item's shape mismatches the screen's shape (square never mismatches). */
export function orientationMismatch(
  media: MediaOrientation | null | undefined,
  device: DeviceOrientation,
): boolean {
  if (!media || media === 'square') return false;
  return media !== expectedMediaOrientation(device);
}
