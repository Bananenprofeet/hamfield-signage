import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEVICE_TOKEN_PREFIX, PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH } from '@signage/shared';
import {
  generateDeviceToken,
  generatePairingCode,
  hashDeviceToken,
  normalizePairingCode,
  safeEqual,
} from './tokens';

describe('generatePairingCode', () => {
  it('produces codes of the right length using only the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generatePairingCode();
      expect(code).toHaveLength(PAIRING_CODE_LENGTH);
      for (const char of code) {
        expect(PAIRING_CODE_ALPHABET).toContain(char);
      }
    }
  });

  it('does not repeat codes in practice', () => {
    const seen = new Set(Array.from({ length: 100 }, () => generatePairingCode()));
    expect(seen.size).toBeGreaterThan(95);
  });
});

describe('normalizePairingCode', () => {
  it('uppercases and strips separators and whitespace', () => {
    expect(normalizePairingCode('  k7tr-2mwp ')).toBe('K7TR2MWP');
    expect(normalizePairingCode('K7TR 2MWP')).toBe('K7TR2MWP');
    expect(normalizePairingCode('k7tr2mwp')).toBe('K7TR2MWP');
  });
});

describe('device tokens', () => {
  it('generates prefixed tokens and stores only a sha256 hash', () => {
    const { token, hash } = generateDeviceToken();
    expect(token.startsWith(DEVICE_TOKEN_PREFIX)).toBe(true);
    expect(token.length).toBe(DEVICE_TOKEN_PREFIX.length + 64);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hash).not.toContain(token.slice(DEVICE_TOKEN_PREFIX.length));
  });

  it('hashes deterministically', () => {
    const { token } = generateDeviceToken();
    expect(hashDeviceToken(token)).toBe(hashDeviceToken(token));
    expect(hashDeviceToken(token)).not.toBe(hashDeviceToken(`${token}x`));
  });
});

describe('safeEqual', () => {
  it('compares equal and unequal strings without throwing on length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});
