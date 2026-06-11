import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { DeviceDto, DeviceGroupDto, PlaylistDto, ScheduleDto } from '@signage/shared';
import {
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
import { useAction, useApi } from '../lib/hooks';

const DAYS: Array<[number, string]> = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [7, 'Sun'],
];

export function ScheduleEditorPage() {
  const orgId = useOrgId();
  const { scheduleId } = useParams();
  const navigate = useNavigate();
  const isNew = !scheduleId;

  const existing = useApi(
    () =>
      scheduleId
        ? api.get<ScheduleDto>(`/orgs/${orgId}/schedules/${scheduleId}`)
        : Promise.resolve(null),
    [orgId, scheduleId],
  );
  const playlists = useApi(() => api.get<PlaylistDto[]>(`/orgs/${orgId}/playlists`), [orgId]);
  const devices = useApi(() => api.get<DeviceDto[]>(`/orgs/${orgId}/devices`), [orgId]);
  const groups = useApi(() => api.get<DeviceGroupDto[]>(`/orgs/${orgId}/device-groups`), [orgId]);

  const [name, setName] = useState('');
  const [playlistId, setPlaylistId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [priority, setPriority] = useState(0);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [timezone, setTimezone] = useState('');
  const [deviceIds, setDeviceIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!existing.data) return;
    const s = existing.data;
    setName(s.name);
    setPlaylistId(s.playlistId);
    setEnabled(s.enabled);
    setPriority(s.priority);
    setStartDate(s.startDate ?? '');
    setEndDate(s.endDate ?? '');
    setDaysOfWeek(s.daysOfWeek);
    setStartTime(s.startTime ?? '');
    setEndTime(s.endTime ?? '');
    setTimezone(s.timezone ?? '');
    setDeviceIds(s.deviceIds);
    setGroupIds(s.groupIds);
  }, [existing.data]);

  const save = useAction(async () => {
    setValidationError(null);
    if (!name.trim()) {
      setValidationError('Name is required.');
      return;
    }
    if (!playlistId) {
      setValidationError('Pick a playlist to play.');
      return;
    }
    if (!!startTime !== !!endTime) {
      setValidationError('Set both a start and end time, or leave both empty.');
      return;
    }
    const body = {
      name: name.trim(),
      playlistId,
      enabled,
      priority,
      startDate: startDate || null,
      endDate: endDate || null,
      daysOfWeek,
      startTime: startTime || null,
      endTime: endTime || null,
      timezone: timezone.trim() || null,
      deviceIds,
      groupIds,
    };
    if (isNew) {
      await api.post(`/orgs/${orgId}/schedules`, body);
    } else {
      await api.patch(`/orgs/${orgId}/schedules/${scheduleId}`, body);
    }
    navigate('/schedules');
  });

  const remove = useAction(async () => {
    if (!scheduleId) return;
    if (!window.confirm(`Delete schedule "${name}"?`)) return;
    await api.delete(`/orgs/${orgId}/schedules/${scheduleId}`);
    navigate('/schedules');
  });

  const toggle = (list: string[], id: string, set: (v: string[]) => void) => {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  if (!isNew && existing.loading && !existing.data) return <Spinner />;
  if (!isNew && existing.error) return <ErrorNote message={existing.error} />;

  return (
    <div>
      <PageHeader
        title={isNew ? 'New schedule' : `Schedule: ${existing.data?.name ?? ''}`}
        subtitle="When this playlist runs — highest priority wins when windows overlap"
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/schedules')}>
              Cancel
            </Button>
            {!isNew ? (
              <Button variant="danger" onClick={() => remove.run()} disabled={remove.busy}>
                Delete
              </Button>
            ) : null}
            <Button onClick={() => save.run()} disabled={save.busy}>
              {save.busy ? 'Saving…' : isNew ? 'Create schedule' : 'Save changes'}
            </Button>
          </>
        }
      />

      <ErrorNote message={validationError ?? save.error ?? remove.error} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card title="What plays">
            <div className="space-y-4">
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus={isNew} />
              </Field>
              <Field label="Playlist">
                <Select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}>
                  <option value="">Select a playlist…</option>
                  {(playlists.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.itemCount} items)
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-end gap-4">
                <div className="w-32">
                  <Field label="Priority" hint="0–1000, higher wins">
                    <Input
                      type="number"
                      min={0}
                      max={1000}
                      value={priority}
                      onChange={(e) => setPriority(Number(e.target.value))}
                    />
                  </Field>
                </div>
                <label className="flex items-center gap-2 pb-6 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                  />
                  Enabled
                </label>
              </div>
            </div>
          </Card>

          <Card title="When it plays">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Start date" hint="Empty = no start limit">
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </Field>
                <Field label="End date" hint="Empty = no end limit">
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </Field>
              </div>
              <div>
                <p className="mb-1 block text-sm font-medium text-slate-700">Days of week</p>
                <p className="mb-2 text-xs text-slate-500">None selected = every day</p>
                <div className="flex flex-wrap gap-3">
                  {DAYS.map(([value, label]) => (
                    <label key={value} className="flex items-center gap-1.5 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={daysOfWeek.includes(value)}
                        onChange={() =>
                          setDaysOfWeek(
                            daysOfWeek.includes(value)
                              ? daysOfWeek.filter((d) => d !== value)
                              : [...daysOfWeek, value].sort((a, b) => a - b),
                          )
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Start time" hint="Empty = all day">
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </Field>
                <Field label="End time" hint="Before start time = overnight window">
                  <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </Field>
              </div>
              <Field
                label="Timezone (optional)"
                hint="IANA zone like Europe/Amsterdam — leave empty to use each screen's own timezone"
              >
                <Input
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="Device timezone"
                />
              </Field>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Target screens">
            {devices.loading && !devices.data ? <Spinner /> : null}
            {(devices.data ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">No screens registered yet.</p>
            ) : (
              <ul className="max-h-72 space-y-1.5 overflow-y-auto">
                {(devices.data ?? []).map((d) => (
                  <li key={d.id}>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={deviceIds.includes(d.id)}
                        onChange={() => toggle(deviceIds, d.id, setDeviceIds)}
                      />
                      {d.name}
                      <span className="text-xs text-slate-400">{d.timezone}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Target groups">
            {(groups.data ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">
                No groups yet — create them under Settings to target many screens at once.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {(groups.data ?? []).map((g) => (
                  <li key={g.id}>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={groupIds.includes(g.id)}
                        onChange={() => toggle(groupIds, g.id, setGroupIds)}
                      />
                      {g.name}
                      <span className="text-xs text-slate-400">{g.deviceCount} screens</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {deviceIds.length + groupIds.length === 0 ? (
            <p className="text-sm text-amber-700">
              No targets selected — this schedule will not apply to any screen until you pick at
              least one screen or group.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
