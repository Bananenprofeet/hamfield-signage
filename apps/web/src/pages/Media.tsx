import { useRef, useState } from 'react';
import type { MediaAssetDto } from '@signage/shared';
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Input,
  PageHeader,
  Select,
  Spinner,
} from '../components/ui';
import { api } from '../lib/api';
import { useOrgId } from '../lib/auth';
import { formatBytes, formatDuration } from '../lib/format';
import { useAction, useApi } from '../lib/hooks';

interface MediaListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: MediaAssetDto[];
}

const STATUS_TONE = {
  pending: 'yellow',
  processing: 'yellow',
  ready: 'green',
  failed: 'red',
} as const;

export function MediaPage() {
  const orgId = useOrgId();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const query = new URLSearchParams();
  if (search) query.set('search', search);
  if (type) query.set('type', type);
  if (status) query.set('status', status);
  query.set('page', String(page));
  query.set('pageSize', '50');

  const media = useApi(
    () => api.get<MediaListResponse>(`/orgs/${orgId}/media?${query.toString()}`),
    [orgId, search, type, status, page],
    // Poll while anything is still processing so thumbnails appear when done.
    { refreshMs: 5_000 },
  );

  const upload = useAction(async (files: FileList) => {
    const list = Array.from(files);
    setUploading({ done: 0, total: list.length });
    try {
      for (let i = 0; i < list.length; i++) {
        await api.upload(`/orgs/${orgId}/media`, list[i]);
        setUploading({ done: i + 1, total: list.length });
      }
    } finally {
      setUploading(null);
      media.reload();
    }
  });

  const totalPages = media.data
    ? Math.max(1, Math.ceil(media.data.total / media.data.pageSize))
    : 1;

  return (
    <div>
      <PageHeader
        title="Media library"
        subtitle="Images and videos available for playlists"
        actions={
          <>
            <input
              ref={fileInput}
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) upload.run(e.target.files);
                e.target.value = '';
              }}
            />
            <Button onClick={() => fileInput.current?.click()} disabled={uploading !== null}>
              {uploading ? `Uploading ${uploading.done}/${uploading.total}…` : 'Upload media'}
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="w-64">
          <Input
            placeholder="Search by name…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-36">
          <Select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All types</option>
            <option value="image">Images</option>
            <option value="video">Videos</option>
          </Select>
        </div>
        <div className="w-36">
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Any status</option>
            <option value="ready">Ready</option>
            <option value="processing">Processing</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </Select>
        </div>
      </div>

      <ErrorNote message={upload.error ?? media.error} />
      {media.loading && !media.data ? <Spinner /> : null}

      {media.data && media.data.items.length === 0 ? (
        <EmptyState title="No media found" hint="Upload images or videos to get started." />
      ) : null}

      {media.data && media.data.items.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {media.data.items.map((item) => (
              <MediaCard key={item.id} orgId={orgId} item={item} onChanged={media.reload} />
            ))}
          </div>
          {totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-center gap-3 text-sm text-slate-600">
              <Button
                variant="secondary"
                small
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              Page {page} of {totalPages}
              <Button
                variant="secondary"
                small
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function MediaCard({
  orgId,
  item,
  onChanged,
}: {
  orgId: string;
  item: MediaAssetDto;
  onChanged: () => void;
}) {
  const action = useAction(async (kind: 'rename' | 'delete' | 'reprocess') => {
    if (kind === 'rename') {
      const name = window.prompt('New name', item.name);
      if (!name || name === item.name) return;
      await api.patch(`/orgs/${orgId}/media/${item.id}`, { name });
    } else if (kind === 'delete') {
      if (!window.confirm(`Delete "${item.name}"? It is removed from all playlists.`)) return;
      await api.delete(`/orgs/${orgId}/media/${item.id}`);
    } else {
      await api.post(`/orgs/${orgId}/media/${item.id}/reprocess`);
    }
    onChanged();
  });

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="relative aspect-video bg-slate-100">
        {item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt={item.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-3xl text-slate-300">
            {item.mediaType === 'video' ? '🎬' : '🖼'}
          </div>
        )}
        {item.durationSeconds ? (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
            {formatDuration(item.durationSeconds)}
          </span>
        ) : null}
      </div>
      <div className="space-y-2 p-3">
        <p className="truncate text-sm font-medium text-slate-800" title={item.name}>
          {item.name}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={STATUS_TONE[item.processingStatus] ?? 'gray'}>{item.processingStatus}</Badge>
          <Badge tone="blue">{item.mediaType}</Badge>
          {item.orientation ? <Badge>{item.orientation}</Badge> : null}
          {item.width && item.height ? (
            <span className="text-xs text-slate-400">
              {item.width}×{item.height}
            </span>
          ) : null}
          <span className="text-xs text-slate-400">{formatBytes(item.sizeBytes)}</span>
        </div>
        {item.processingStatus === 'failed' && item.processingError ? (
          <p className="break-words text-xs text-red-600" title={item.processingError}>
            {item.processingError.slice(0, 120)}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-1 pt-1">
          {item.previewUrl ? (
            <a
              href={item.previewUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
            >
              Preview
            </a>
          ) : null}
          <Button variant="ghost" small onClick={() => action.run('rename')} disabled={action.busy}>
            Rename
          </Button>
          {item.processingStatus === 'failed' ? (
            <Button
              variant="ghost"
              small
              onClick={() => action.run('reprocess')}
              disabled={action.busy}
            >
              Retry
            </Button>
          ) : null}
          <Button variant="ghost" small onClick={() => action.run('delete')} disabled={action.busy}>
            Delete
          </Button>
        </div>
        <ErrorNote message={action.error} />
      </div>
    </div>
  );
}
