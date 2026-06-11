# Sync protocol

How a device's content gets from the cloud to the screen, and why an interrupted
or corrupted sync can never break playback. Types live in
`packages/sync-protocol` and are shared by the API (producer) and the agent
(consumer).

## The manifest

`GET /api/v1/device/sync` returns `{ manifest, commands }`. The manifest is the
**complete desired state** for one device — not a delta:

```jsonc
{
  "protocolVersion": 1, // breaking-change gate
  "version": "8f3a…", // content hash of everything below
  "generatedAt": "2026-06-11T09:00:00.000Z",
  "deviceId": "dev_…",

  "settings": {
    "name": "Lobby screen",
    "orientation": "landscape", // landscape | portrait | inverted_*
    "timezone": "Europe/Amsterdam",
    "defaultPlaylistId": "pl_…", // or null
  },

  "emergency": {
    "active": false,
    "playlistId": null, // exactly one of playlistId/mediaAssetId when active
    "mediaAssetId": null,
    "startedAt": null,
  },

  "schedules": [
    /* windows + priority + playlistId; resolved on-device */
  ],

  "playlists": [
    {
      "id": "pl_…",
      "name": "Default",
      "loop": true,
      "defaultImageDurationSeconds": 10,
      "items": [
        {
          "id": "item_…",
          "mediaId": "med_…",
          "position": 0,
          "durationSeconds": null, // null → image inherits playlist default, video plays natural length
          "fitMode": null, // null → platform default "contain"
          "enabled": true,
        },
      ],
    },
  ],

  "media": [
    {
      "id": "med_…",
      "name": "poster.jpg",
      "type": "image", // image | video
      "mimeType": "image/jpeg",
      "checksum": "sha256-hex…",
      "sizeBytes": 482133,
      "width": 1920,
      "height": 1080,
      "orientation": "landscape",
      "durationSeconds": null, // natural duration for videos
      "downloadPath": "/api/v1/device/media/med_…/file",
    },
  ],
}
```

Only media actually referenced by the device's playlists/schedules/emergency is
included, so the media list doubles as the cache's desired contents.

## Versioning

- **`protocolVersion`** — incremented only for incompatible shape changes. An
  agent that sees a higher protocol version than it understands reports a sync
  error instead of guessing; old agents keep playing their cached content until
  they are updated.
- **`version`** — a deterministic hash of the manifest content. The server bumps
  it whenever anything affecting this device changes (settings, playlist edits,
  schedule changes, emergency start/stop, media replacement). The agent compares
  it with the last applied version and **skips the entire sync when unchanged**,
  making the poll loop nearly free.

When relevant state changes, the server also pushes `sync_required` over the
WebSocket so connected devices react within seconds; polling devices pick the
change up on the next interval.

## Sync algorithm (agent)

The agent keeps a SQLite database (`better-sqlite3`) with the applied manifest,
a `media_cache` index (`mediaId`, `checksum`, `sizeBytes`, file path), and
bounded log/event buffers. One sync pass:

1. **Fetch** the manifest. If `version` equals the applied version → done.
2. **Diff** (`diffManifest`) the manifest's media list against the cache index by
   id + checksum → `toDownload`, `toDelete`, `unchanged`. A changed checksum for
   the same id is treated as a new download (media replacement).
3. **Report** `sync-status: downloading` when there is anything to fetch.
4. **Download** each new file from its `downloadPath` to a **temp file**, compute
   SHA-256 while streaming, and compare with the manifest checksum.
   - Mismatch or failed download → delete the temp file and **abort the whole
     sync**: report `sync-status: failed` with the reason, buffer a log line, and
     leave the previous manifest, cache index, and files fully intact. The screen
     keeps playing the old content. The sync is retried later (next poll,
     `sync_required` push, or `refresh_content` command).
   - Match → atomically rename the temp file into the media directory.
5. **Commit** — in a single SQLite transaction: store the new manifest +
   `version` and replace the cache index rows. This is the atomic switch; the
   player state recomputes from the new manifest immediately after.
6. **Clean up** — only after the commit, delete files for `toDelete` entries.
   A crash between commit and cleanup leaves harmless orphan files that the next
   sync removes; the reverse order could delete files the current manifest needs.
7. **Report** `sync-status: applied` with the new version. The dashboard renders
   this as the screen's sync state (`never_synced | syncing | in_sync | error`).

Concurrent triggers (poll timer, WS push, command) are coalesced: a sync request
arriving mid-run queues exactly one re-run instead of racing.

## Playback resolution

What actually plays is computed locally and offline from the applied manifest by
`computePlayerState` (agent) using `@signage/scheduler`:

1. Active emergency → its playlist, or a single media asset looping.
2. Highest-priority schedule whose window matches the local (timezone-aware) time.
3. `settings.defaultPlaylistId`.
4. Otherwise a status screen ("No content scheduled") — never a blank screen.

Disabled items are skipped. Items whose media is not yet cached are skipped with
a "downloading" status rather than blocking the rest of the playlist; they join
playback as soon as their download lands. Images default to the playlist's
`defaultImageDurationSeconds` (10s), videos to their natural duration; `fitMode`
defaults to `contain`.

## Failure-mode summary

| Failure                               | Outcome                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| Network down                          | Cached manifest keeps playing; schedules keep switching on-device.            |
| Download interrupted                  | Temp file discarded; sync retried; old content unaffected.                    |
| Checksum mismatch (corruption/tamper) | Whole sync rejected; `failed` status reported; old content unaffected.        |
| Crash mid-download                    | Temp files ignored/overwritten on the next pass.                              |
| Crash after commit, before cleanup    | Orphan files only; removed by next sync.                                      |
| Unknown `protocolVersion`             | Sync error reported; cached content keeps playing until the agent is updated. |

These guarantees are covered by tests in `apps/agent/src/sync.test.ts` and
`packages/sync-protocol`.
