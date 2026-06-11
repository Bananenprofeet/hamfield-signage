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

export const SYNC_PROTOCOL_VERSION = 1;

export const API_PREFIX = '/api/v1';
