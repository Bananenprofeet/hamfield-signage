import { describe, expect, it } from 'vitest';
import {
  createPlaylistSchema,
  playlistItemInputSchema,
  startEmergencySchema,
  updatePlaylistSchema,
} from './schemas';

describe('playlist display schema validation', () => {
  it('accepts a valid default fit mode and background color', () => {
    const parsed = createPlaylistSchema.parse({
      name: 'P',
      defaultFitMode: 'scale_down',
      defaultBackgroundColor: '#FFF',
      defaultPositionMode: 'top_left',
    });
    expect(parsed.defaultFitMode).toBe('scale_down');
    expect(parsed.defaultBackgroundColor).toBe('#ffffff'); // normalized
    expect(parsed.defaultPositionMode).toBe('top_left');
  });

  it('rejects an invalid fit mode', () => {
    expect(() => updatePlaylistSchema.parse({ defaultFitMode: 'zoom' })).toThrow();
  });

  it('rejects an invalid background color', () => {
    expect(() => updatePlaylistSchema.parse({ defaultBackgroundColor: 'red' })).toThrow();
    expect(() => updatePlaylistSchema.parse({ defaultBackgroundColor: '#000; url(x)' })).toThrow();
  });

  it('accepts display settings on a playlist item', () => {
    const parsed = playlistItemInputSchema.parse({
      type: 'media',
      mediaAssetId: 'm1',
      fitMode: 'cover',
      backgroundColor: '#1f2937',
      positionMode: 'bottom',
    });
    expect(parsed.fitMode).toBe('cover');
    expect(parsed.backgroundColor).toBe('#1f2937');
    expect(parsed.positionMode).toBe('bottom');
  });

  it('rejects an invalid position mode on an item', () => {
    expect(() =>
      playlistItemInputSchema.parse({ type: 'media', mediaAssetId: 'm1', positionMode: 'middle' }),
    ).toThrow();
  });

  it('accepts display settings on a single-media emergency override', () => {
    const parsed = startEmergencySchema.parse({
      mediaAssetId: 'm1',
      appliesToAll: true,
      fitMode: 'stretch',
      backgroundColor: '#abc',
    });
    expect(parsed.fitMode).toBe('stretch');
    expect(parsed.backgroundColor).toBe('#aabbcc');
  });
});
