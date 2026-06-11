import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DEVICE_TOKEN_PREFIX, PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH } from '@signage/shared';

/** Generates a human-typable pairing code, e.g. "K7TR2MWP". */
export function generatePairingCode(): string {
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += PAIRING_CODE_ALPHABET[bytes[i] % PAIRING_CODE_ALPHABET.length];
  }
  return code;
}

export function normalizePairingCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Generates a long-lived device token. Only its hash is stored. */
export function generateDeviceToken(): { token: string; hash: string } {
  const token = `${DEVICE_TOKEN_PREFIX}${randomBytes(32).toString('hex')}`;
  return { token, hash: hashDeviceToken(token) };
}

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
