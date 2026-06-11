import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { MediaAssetDto, PlaylistDto, PlaylistItemDto } from '@signage/shared';
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
import { formatDuration } from '../lib/format';
import { useAction, useApi } from '../lib/hooks';

interface EditableItem {
  key: string;
  mediaAssetId: string;
  mediaName: string;
  mediaType: 'image' | 'video';
  mediaDuration: number | null;
  thumbnailUrl?: string | null;
  durationSeconds: number | null;
  fitMode: '' | 'contain' | 'cover' | 'stretch' | 'original';
  enabled: boolean;
}

let nextKey = 1;

function toEditable(item: PlaylistItemDto): EditableItem {
  return {
    key: `existing-${item.id}`,
    mediaAssetId: item.mediaAssetId,
    mediaName: item.media?.name ?? item.mediaAssetId,
    mediaType: (item.media?.mediaType ?? 'image') as 'image' | 'video',
    mediaDuration: item.media?.durationSeconds ?? null,
    thumbnailUrl: item.media?.thumbnailUrl,
    durationSeconds: item.durationSeconds,
    fitMode: (item.fitMode ?? '') as EditableItem['fitMode'],
    enabled: item.enabled,
  };
}

export function PlaylistEditorPage() {
  const orgId = useOrgId();
  const { playlistId = '' } = useParams();
  const navigate = useNavigate();

  const playlist = useApi(
    () => api.get<PlaylistDto>(`/orgs/${orgId}/playlists/${playlistId}`),
    [orgId, playlistId],
  );

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loop, setLoop] = useState(true);
  const [defaultDuration, setDefaultDuration] = useState(10);
  const [items, setItems] = useState<EditableItem[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!playlist.data) return;
    setName(playlist.data.name);
    setDescription(playlist.data.description ?? '');
    setLoop(playlist.data.loop);
    setDefaultDuration(playlist.data.defaultImageDurationSeconds);
    setItems((playlist.data.items ?? []).map(toEditable));
    setDirty(false);
  }, [playlist.data]);

  const save = useAction(async () => {
    await api.patch(`/orgs/${orgId}/playlists/${playlistId}`, {
      name,
      description: description || null,
      loop,
      defaultImageDurationSeconds: defaultDuration,
    });
    await api.put(`/orgs/${orgId}/playlists/${playlistId}/items`, {
      items: items.map((item) => ({
        mediaAssetId: item.mediaAssetId,
        durationSeconds: item.durationSeconds,
        fitMode: item.fitMode || null,
        enabled: item.enabled,
      })),
    });
    setDirty(false);
    playlist.reload();
  });

  const mutate = (fn: (items: EditableItem[]) => EditableItem[]) => {
    setItems(fn);
    setDirty(true);
  };

  const move = (index: number, delta: number) => {
    mutate((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const totalSeconds = items.reduce((sum, item) => {
    if (!item.enabled) return sum;
    const duration =
      item.durationSeconds ??
      (item.mediaType === 'image' ? defaultDuration : (item.mediaDuration ?? 0));
    return sum + duration;
  }, 0);

  if (playlist.loading && !playlist.data) return <Spinner />;
  if (playlist.error) return <ErrorNote message={playlist.error} />;

  return (
    <div>
      <PageHeader
        title={`Playlist: ${playlist.data?.name ?? ''}`}
        subtitle={`${items.filter((i) => i.enabled).length} active items · ${formatDuration(totalSeconds)} per loop`}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/playlists')}>
              Back
            </Button>
            <Button onClick={() => save.run()} disabled={save.busy || !dirty}>
              {save.busy ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
            </Button>
          </>
        }
      />
      <ErrorNote message={save.error} />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card title="Playlist settings">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setDirty(true);
                  }}
                />
              </Field>
              <Field label="Description">
                <Input
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setDirty(true);
                  }}
                />
              </Field>
              <Field label="Default image duration (s)">
                <Input
                  type="number"
                  min={1}
                  value={defaultDuration}
                  onChange={(e) => {
                    setDefaultDuration(Number(e.target.value));
                    setDirty(true);
                  }}
                />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={loop}
                  onChange={(e) => {
                    setLoop(e.target.checked);
                    setDirty(true);
                  }}
                />
                Loop playlist
              </label>
            </div>
          </Card>

          <Card title="Items">
            {items.length === 0 ? (
              <p className="text-sm text-slate-500">
                No items yet — add media from the library on the right.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {items.map((item, index) => (
                  <li key={item.key} className="flex items-center gap-3 py-2.5">
                    <div className="flex flex-col gap-0.5">
                      <button
                        className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        aria-label="Move up"
                      >
                        ▲
                      </button>
                      <button
                        className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                        disabled={index === items.length - 1}
                        onClick={() => move(index, 1)}
                        aria-label="Move down"
                      >
                        ▼
                      </button>
                    </div>
                    <div className="h-12 w-20 shrink-0 overflow-hidden rounded bg-slate-100">
                      {item.thumbnailUrl ? (
                        <img
                          src={item.thumbnailUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-lg text-slate-300">
                          {item.mediaType === 'video' ? '🎬' : '🖼'}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {item.mediaName}
                      </p>
                      <p className="text-xs text-slate-400">
                        {item.mediaType}
                        {item.mediaType === 'video' && item.mediaDuration
                          ? ` · ${formatDuration(item.mediaDuration)}`
                          : ''}
                      </p>
                    </div>
                    <div className="w-24">
                      <Input
                        type="number"
                        min={1}
                        placeholder={item.mediaType === 'image' ? String(defaultDuration) : 'auto'}
                        value={item.durationSeconds ?? ''}
                        title="Duration in seconds (empty = default)"
                        onChange={(e) =>
                          mutate((list) =>
                            list.map((x) =>
                              x.key === item.key
                                ? {
                                    ...x,
                                    durationSeconds: e.target.value ? Number(e.target.value) : null,
                                  }
                                : x,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="w-28">
                      <Select
                        value={item.fitMode}
                        onChange={(e) =>
                          mutate((list) =>
                            list.map((x) =>
                              x.key === item.key
                                ? { ...x, fitMode: e.target.value as EditableItem['fitMode'] }
                                : x,
                            ),
                          )
                        }
                      >
                        <option value="">Default fit</option>
                        <option value="contain">Contain</option>
                        <option value="cover">Cover</option>
                        <option value="stretch">Stretch</option>
                        <option value="original">Original</option>
                      </Select>
                    </div>
                    <label
                      className="flex items-center gap-1 text-xs text-slate-500"
                      title="Enabled"
                    >
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        onChange={(e) =>
                          mutate((list) =>
                            list.map((x) =>
                              x.key === item.key ? { ...x, enabled: e.target.checked } : x,
                            ),
                          )
                        }
                      />
                      on
                    </label>
                    <Button
                      variant="ghost"
                      small
                      onClick={() => mutate((list) => list.filter((x) => x.key !== item.key))}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="lg:col-span-2">
          <MediaPicker
            orgId={orgId}
            onAdd={(media) =>
              mutate((list) => [
                ...list,
                {
                  key: `new-${nextKey++}`,
                  mediaAssetId: media.id,
                  mediaName: media.name,
                  mediaType: media.mediaType,
                  mediaDuration: media.durationSeconds,
                  thumbnailUrl: media.thumbnailUrl,
                  durationSeconds: null,
                  fitMode: '',
                  enabled: true,
                },
              ])
            }
          />
        </div>
      </div>
    </div>
  );
}

function MediaPicker({ orgId, onAdd }: { orgId: string; onAdd: (media: MediaAssetDto) => void }) {
  const [search, setSearch] = useState('');
  const media = useApi(
    () =>
      api.get<{ items: MediaAssetDto[] }>(
        `/orgs/${orgId}/media?status=ready&pageSize=100${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
    [orgId, search],
  );

  return (
    <Card title="Media library" actions={<Badge tone="blue">ready only</Badge>}>
      <div className="mb-3">
        <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {media.loading && !media.data ? <Spinner /> : null}
      {media.error ? <ErrorNote message={media.error} /> : null}
      <ul className="max-h-[34rem] divide-y divide-slate-100 overflow-y-auto">
        {(media.data?.items ?? []).map((item) => (
          <li key={item.id} className="flex items-center gap-3 py-2">
            <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-slate-100">
              {item.thumbnailUrl ? (
                <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-slate-300">
                  {item.mediaType === 'video' ? '🎬' : '🖼'}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-slate-800">{item.name}</p>
              <p className="text-xs text-slate-400">
                {item.mediaType}
                {item.durationSeconds ? ` · ${formatDuration(item.durationSeconds)}` : ''}
                {item.orientation ? ` · ${item.orientation}` : ''}
              </p>
            </div>
            <Button variant="secondary" small onClick={() => onAdd(item)}>
              Add
            </Button>
          </li>
        ))}
        {media.data && media.data.items.length === 0 ? (
          <li className="py-4 text-center text-sm text-slate-500">No ready media found.</li>
        ) : null}
      </ul>
    </Card>
  );
}
