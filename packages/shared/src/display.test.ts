import { describe, expect, it } from 'vitest';
import { FIT_MODES, POSITION_MODES } from './enums';
import {
  cssObjectPosition,
  flexAlignment,
  isValidHexColor,
  normalizeHexColor,
  resolveDisplaySettings,
} from './display';

describe('FIT_MODES', () => {
  it('includes all five modes', () => {
    expect(FIT_MODES).toEqual(['contain', 'cover', 'stretch', 'original', 'scale_down']);
  });
});

describe('hex color validation', () => {
  it('accepts #RRGGBB and #RGB', () => {
    expect(isValidHexColor('#000000')).toBe(true);
    expect(isValidHexColor('#FFF')).toBe(true);
    expect(isValidHexColor('#1f2937')).toBe(true);
  });
  it('rejects invalid values (prevents CSS injection)', () => {
    expect(isValidHexColor('red')).toBe(false);
    expect(isValidHexColor('rgb(0,0,0)')).toBe(false);
    expect(isValidHexColor('#12')).toBe(false);
    expect(isValidHexColor('#xyzxyz')).toBe(false);
    expect(isValidHexColor('#000; background:url(x)')).toBe(false);
  });
  it('normalizes to lowercase #rrggbb', () => {
    expect(normalizeHexColor('#FFF')).toBe('#ffffff');
    expect(normalizeHexColor('#1F2937')).toBe('#1f2937');
    expect(normalizeHexColor('not-a-color')).toBeNull();
  });
});

describe('resolveDisplaySettings precedence', () => {
  it('falls back to platform defaults when nothing is set', () => {
    expect(resolveDisplaySettings(null, null)).toEqual({
      fitMode: 'contain',
      backgroundColor: '#000000',
      positionMode: 'center',
    });
  });

  it('item override wins over playlist default', () => {
    const r = resolveDisplaySettings(
      { fitMode: 'cover', backgroundColor: '#ffffff', positionMode: 'top' },
      { defaultFitMode: 'stretch', defaultBackgroundColor: '#111111', defaultPositionMode: 'left' },
    );
    expect(r).toEqual({ fitMode: 'cover', backgroundColor: '#ffffff', positionMode: 'top' });
  });

  it('playlist default applies when item value is null', () => {
    const r = resolveDisplaySettings(
      { fitMode: null, backgroundColor: null, positionMode: null },
      { defaultFitMode: 'scale_down', defaultBackgroundColor: '#222222' },
    );
    expect(r.fitMode).toBe('scale_down');
    expect(r.backgroundColor).toBe('#222222');
    expect(r.positionMode).toBe('center');
  });

  it('normalizes hex and ignores invalid values', () => {
    const r = resolveDisplaySettings(
      { backgroundColor: '#ABC' },
      { defaultBackgroundColor: 'not-a-color' },
    );
    expect(r.backgroundColor).toBe('#aabbcc');
  });

  it('ignores an invalid fit mode and uses the default', () => {
    const r = resolveDisplaySettings({ fitMode: 'bogus' as never }, { defaultFitMode: 'cover' });
    expect(r.fitMode).toBe('cover');
  });
});

describe('css mapping', () => {
  it('maps every position mode to a css object-position', () => {
    for (const p of POSITION_MODES) {
      expect(cssObjectPosition(p)).toMatch(/(left|right|center|top|bottom)/);
    }
  });
  it('maps corners to flex alignment', () => {
    expect(flexAlignment('top_left')).toEqual({ justify: 'flex-start', align: 'flex-start' });
    expect(flexAlignment('bottom_right')).toEqual({ justify: 'flex-end', align: 'flex-end' });
    expect(flexAlignment('center')).toEqual({ justify: 'center', align: 'center' });
  });
});
