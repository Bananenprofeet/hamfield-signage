import {
  cssObjectPosition,
  type FitMode,
  type MediaType,
  type PositionMode,
} from '@signage/shared';

/**
 * Visually approximates how the device player will render a media item with the
 * given fit mode / background / position, inside a simulated screen viewport.
 * Mirrors the player's CSS mapping (apps/player/src/style.css) so the dashboard
 * preview matches real playback.
 */
export function MediaDisplayPreview({
  thumbnailUrl,
  mediaType,
  width,
  height,
  fitMode,
  backgroundColor,
  positionMode,
  orientation = 'landscape',
  className = '',
}: {
  thumbnailUrl: string | null | undefined;
  mediaType: MediaType;
  width?: number | null;
  height?: number | null;
  fitMode: FitMode;
  backgroundColor: string;
  positionMode: PositionMode;
  /** Simulated screen orientation. */
  orientation?: 'landscape' | 'portrait';
  className?: string;
}) {
  // The simulated screen: landscape 16:9 or portrait 9:16.
  const aspect = orientation === 'portrait' ? '9 / 16' : '16 / 9';

  const imgStyle: React.CSSProperties = { objectPosition: cssObjectPosition(positionMode) };
  switch (fitMode) {
    case 'contain':
      Object.assign(imgStyle, { width: '100%', height: '100%', objectFit: 'contain' });
      break;
    case 'cover':
      Object.assign(imgStyle, { width: '100%', height: '100%', objectFit: 'cover' });
      break;
    case 'stretch':
      Object.assign(imgStyle, { width: '100%', height: '100%', objectFit: 'fill' });
      break;
    case 'original':
      // Natural size scaled into the preview box: approximate by capping at the
      // preview while preserving ratio (true 1:1 px is meaningless at this scale).
      Object.assign(imgStyle, { maxWidth: '100%', maxHeight: '100%', objectFit: 'none' });
      break;
    case 'scale_down':
      Object.assign(imgStyle, { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' });
      break;
  }

  const align = {
    justifyContent: positionMode.includes('left')
      ? 'flex-start'
      : positionMode.includes('right')
        ? 'flex-end'
        : 'center',
    alignItems: positionMode.includes('top')
      ? 'flex-start'
      : positionMode.includes('bottom')
        ? 'flex-end'
        : 'center',
  } as const;

  return (
    <div
      className={`flex overflow-hidden rounded border border-slate-300 ${className}`}
      style={{ aspectRatio: aspect, backgroundColor, ...align }}
    >
      {thumbnailUrl ? (
        // eslint-disable-next-line jsx-a11y/img-redundant-alt
        <img src={thumbnailUrl} alt="display preview" style={imgStyle} />
      ) : (
        <div className="m-auto p-2 text-center text-[10px] text-slate-400">
          {mediaType === 'video' ? 'Video' : 'Image'} preview
          {width && height ? ` · ${width}×${height}` : ''}
        </div>
      )}
    </div>
  );
}
