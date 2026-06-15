import {
  DEFAULT_BACKGROUND_COLOR,
  FIT_MODES,
  FIT_MODE_INFO,
  POSITION_MODES,
  POSITION_MODE_LABELS,
  isValidHexColor,
  type FitMode,
  type PositionMode,
} from '@signage/shared';

export interface DisplayValue {
  fitMode: FitMode | null;
  backgroundColor: string | null;
  positionMode: PositionMode | null;
}

/**
 * Fit mode + background color + position controls. Used for playlist items
 * (with an "inherit" option) and for playlist/emergency defaults.
 */
export function DisplaySettingsControls({
  value,
  onChange,
  inheritLabel,
}: {
  value: DisplayValue;
  onChange: (next: DisplayValue) => void;
  /** Label for the "unset" option (e.g. "Playlist default"). Omit to force a value. */
  inheritLabel?: string;
}) {
  const set = (patch: Partial<DisplayValue>) => onChange({ ...value, ...patch });
  const bg = value.backgroundColor ?? '';
  const bgValid = bg === '' || isValidHexColor(bg);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Fit mode</span>
          <select
            value={value.fitMode ?? ''}
            onChange={(e) => set({ fitMode: (e.target.value || null) as FitMode | null })}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            {inheritLabel ? <option value="">{inheritLabel}</option> : null}
            {FIT_MODES.map((m) => (
              <option key={m} value={m}>
                {FIT_MODE_INFO[m].label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Position</span>
          <select
            value={value.positionMode ?? ''}
            onChange={(e) => set({ positionMode: (e.target.value || null) as PositionMode | null })}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            {inheritLabel ? <option value="">{inheritLabel}</option> : null}
            {POSITION_MODES.map((p) => (
              <option key={p} value={p}>
                {POSITION_MODE_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {value.fitMode ? (
        <p className="text-xs text-slate-500">{FIT_MODE_INFO[value.fitMode].description}</p>
      ) : null}

      <div>
        <span className="mb-1 block text-xs font-medium text-slate-600">Background color</span>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={isValidHexColor(bg) ? bg : DEFAULT_BACKGROUND_COLOR}
            onChange={(e) => set({ backgroundColor: e.target.value })}
            className="h-8 w-10 cursor-pointer rounded border border-slate-300"
            aria-label="Background color picker"
          />
          <input
            type="text"
            value={bg}
            placeholder={inheritLabel ?? DEFAULT_BACKGROUND_COLOR}
            onChange={(e) => set({ backgroundColor: e.target.value || null })}
            className={`w-28 rounded-md border px-2 py-1.5 text-sm ${
              bgValid ? 'border-slate-300' : 'border-red-400'
            }`}
          />
          {value.backgroundColor ? (
            <button
              type="button"
              onClick={() => set({ backgroundColor: null })}
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              Reset
            </button>
          ) : null}
        </div>
        {!bgValid ? (
          <p className="mt-1 text-xs text-red-600">Use a hex color like #000000 or #fff.</p>
        ) : null}
      </div>
    </div>
  );
}
