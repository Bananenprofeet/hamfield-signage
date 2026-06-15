export const DEFAULT_IMAGE_DURATION_SECONDS = 10;
export const DEFAULT_FIT_MODE = 'contain' as const;
export const DEFAULT_DEVICE_ORIENTATION = 'landscape' as const;
export const DEFAULT_TIMEZONE = 'UTC';
export const DEFAULT_MAX_CACHE_SIZE_GB = 8;

export const PAIRING_CODE_LENGTH = 8;
/** Characters used in pairing codes; ambiguous chars (0/O, 1/I/L) removed. */
export const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const DEVICE_TOKEN_PREFIX = 'sgd_';

export const HEARTBEAT_INTERVAL_SECONDS = 30;
export const OFFLINE_THRESHOLD_SECONDS = 90;
export const SYNC_INTERVAL_SECONDS = 60;
export const POLL_FALLBACK_INTERVAL_SECONDS = 30;

/**
 * v2 adds: playback order modes, server-resolved dynamic folder entries and
 * priority rules. The manifest stays backwards compatible for manual
 * playback: v1 agents ignore the new fields and keep playing resolved items
 * in manifest order.
 */
export const SYNC_PROTOCOL_VERSION = 2;

export const API_PREFIX = '/api/v1';

// ---------- Organization logos ----------
/** Maximum organization logo upload size (2 MB). */
export const ORG_LOGO_MAX_BYTES = 2 * 1024 * 1024;
/** MIME types accepted for organization logos. */
export const ORG_LOGO_MIME_TYPES = ['image/svg+xml', 'image/png', 'image/jpeg'] as const;
/** `accept` attribute value for the logo file picker. */
export const ORG_LOGO_ACCEPT = '.svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg';
