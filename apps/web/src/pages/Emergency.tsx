import { useState } from 'react';
import type {
  DeviceDto,
  DeviceGroupDto,
  EmergencyOverrideDto,
  MediaAssetDto,
  PlaylistDto,
} from '@signage/shared';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from '../components/ui';
import { api } from '../lib/api';
import { useOrgId } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { useAction, useApi } from '../lib/hooks';

export function EmergencyPage() {
  const orgId = useOrgId();
  const overrides = useApi(
    () => api.get<EmergencyOverrideDto[]>(`/orgs/${orgId}/emergency`),
    [orgId],
    { refreshMs: 10_000 },
  );

  const playlists = useApi(() => api.get<PlaylistDto[]>(`/orgs/${orgId}/playlists`), [orgId]);
  const media = useApi(
    () => api.get<{ items: MediaAssetDto[] }>(`/orgs/${orgId}/media?status=ready&pageSize=100`),
    [orgId],
  );

  const active = (overrides.data ?? []).filter((o) => o.active);
  const past = (overrides.data ?? []).filter((o) => !o.active);

  const stop = useAction(async (override: EmergencyOverrideDto) => {
    if (
      !window.confirm(
        `Stop "${override.name ?? 'emergency override'}"? Screens return to their normal schedule.`,
      )
    ) {
      return;
    }
    await api.post(`/orgs/${orgId}/emergency/${override.id}/stop`);
    overrides.reload();
  });

  const lookupContent = (o: EmergencyOverrideDto): string => {
    if (o.playlistId) {
      return playlists.data?.find((p) => p.id === o.playlistId)?.name ?? 'Playlist';
    }
    if (o.mediaAssetId) {
      return media.data?.items.find((m) => m.id === o.mediaAssetId)?.name ?? 'Media';
    }
    return '—';
  };

  return (
    <div>
      <PageHeader
        title="Emergency override"
        subtitle="Interrupt all or selected screens immediately — overrides every schedule"
      />

      <ErrorNote message={overrides.error ?? stop.error} />
      {overrides.loading && !overrides.data ? <Spinner /> : null}

      {active.length > 0 ? (
        <div className="mb-6 space-y-3">
          {active.map((o) => (
            <div
              key={o.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-red-300 bg-red-50 p-4"
            >
              <div>
                <p className="flex items-center gap-2 font-semibold text-red-800">
                  <Badge tone="red">ACTIVE</Badge>
                  {o.name ?? 'Emergency override'}
                </p>
                <p className="mt-1 text-sm text-red-700">
                  Showing <strong>{lookupContent(o)}</strong> on{' '}
                  {o.appliesToAll
                    ? 'all screens'
                    : `${o.deviceIds.length} screens, ${o.groupIds.length} groups`}{' '}
                  since {formatDateTime(o.startedAt)}
                </p>
              </div>
              <Button variant="danger" onClick={() => stop.run(o)} disabled={stop.busy}>
                Stop override
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          No emergency override is active — all screens follow their normal schedules.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <StartOverrideForm
          orgId={orgId}
          playlists={playlists.data ?? []}
          media={media.data?.items ?? []}
          onStarted={overrides.reload}
        />

        <Card title="History">
          {past.length === 0 ? (
            <p className="text-sm text-slate-500">No past overrides.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {past.map((o) => (
                <li key={o.id} className="py-2.5 text-sm">
                  <p className="font-medium text-slate-800">{o.name ?? 'Emergency override'}</p>
                  <p className="text-xs text-slate-500">
                    {lookupContent(o)} ·{' '}
                    {o.appliesToAll
                      ? 'all screens'
                      : `${o.deviceIds.length} screens, ${o.groupIds.length} groups`}{' '}
                    · {formatDateTime(o.startedAt)} →{' '}
                    {o.stoppedAt ? formatDateTime(o.stoppedAt) : '?'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function StartOverrideForm({
  orgId,
  playlists,
  media,
  onStarted,
}: {
  orgId: string;
  playlists: PlaylistDto[];
  media: MediaAssetDto[];
  onStarted: () => void;
}) {
  const devices = useApi(() => api.get<DeviceDto[]>(`/orgs/${orgId}/devices`), [orgId]);
  const groups = useApi(() => api.get<DeviceGroupDto[]>(`/orgs/${orgId}/device-groups`), [orgId]);

  const [name, setName] = useState('');
  const [contentKind, setContentKind] = useState<'playlist' | 'media'>('playlist');
  const [contentId, setContentId] = useState('');
  const [appliesToAll, setAppliesToAll] = useState(true);
  const [deviceIds, setDeviceIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  const start = useAction(async () => {
    setValidationError(null);
    if (!contentId) {
      setValidationError(`Pick a ${contentKind} to show.`);
      return;
    }
    if (!appliesToAll && deviceIds.length + groupIds.length === 0) {
      setValidationError('Select at least one screen or group, or apply to all screens.');
      return;
    }
    const targetLabel = appliesToAll
      ? 'ALL screens'
      : `${deviceIds.length} screens and ${groupIds.length} groups`;
    if (
      !window.confirm(
        `Start emergency override on ${targetLabel}? This interrupts playback immediately.`,
      )
    ) {
      return;
    }
    await api.post(`/orgs/${orgId}/emergency`, {
      name: name.trim() || undefined,
      playlistId: contentKind === 'playlist' ? contentId : undefined,
      mediaAssetId: contentKind === 'media' ? contentId : undefined,
      appliesToAll,
      deviceIds: appliesToAll ? [] : deviceIds,
      groupIds: appliesToAll ? [] : groupIds,
    });
    setName('');
    setContentId('');
    onStarted();
  });

  const toggle = (list: string[], id: string, set: (v: string[]) => void) => {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  return (
    <Card title="Start an override">
      <div className="space-y-4">
        <Field label="Name (optional)">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Fire alarm notice"
          />
        </Field>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Content to show</p>
          <div className="mb-2 flex gap-4 text-sm text-slate-700">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={contentKind === 'playlist'}
                onChange={() => {
                  setContentKind('playlist');
                  setContentId('');
                }}
              />
              Playlist
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={contentKind === 'media'}
                onChange={() => {
                  setContentKind('media');
                  setContentId('');
                }}
              />
              Single media item
            </label>
          </div>
          <Select value={contentId} onChange={(e) => setContentId(e.target.value)}>
            <option value="">Select {contentKind === 'playlist' ? 'a playlist' : 'media'}…</option>
            {contentKind === 'playlist'
              ? playlists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))
              : media.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.mediaType})
                  </option>
                ))}
          </Select>
        </div>

        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={appliesToAll}
            onChange={(e) => setAppliesToAll(e.target.checked)}
          />
          Apply to all screens in this organization
        </label>

        {!appliesToAll ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-sm font-medium text-slate-700">Screens</p>
              <ul className="max-h-44 space-y-1.5 overflow-y-auto">
                {(devices.data ?? []).map((d) => (
                  <li key={d.id}>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={deviceIds.includes(d.id)}
                        onChange={() => toggle(deviceIds, d.id, setDeviceIds)}
                      />
                      {d.name}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-slate-700">Groups</p>
              <ul className="max-h-44 space-y-1.5 overflow-y-auto">
                {(groups.data ?? []).map((g) => (
                  <li key={g.id}>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={groupIds.includes(g.id)}
                        onChange={() => toggle(groupIds, g.id, setGroupIds)}
                      />
                      {g.name}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        <ErrorNote message={validationError ?? start.error} />
        <Button variant="danger" onClick={() => start.run()} disabled={start.busy}>
          {start.busy ? 'Starting…' : 'Start emergency override'}
        </Button>
        <p className="text-xs text-slate-500">
          Requires the admin role. Screens switch within seconds when connected, or on their next
          poll when offline.
        </p>
      </div>
    </Card>
  );
}
