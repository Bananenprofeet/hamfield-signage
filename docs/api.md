# API Reference

Base URL: `/api/v1`. All bodies are JSON unless noted. Errors return
`{ "error": { "message": string, ... } }` with an appropriate HTTP status.

There are two authentication schemes:

- **User API** — `Authorization: Bearer <JWT>` from `/auth/login`. All
  `/orgs/:orgId/...` routes additionally require membership in that organization
  with a sufficient role. Convention: reads require `viewer`, content changes
  require `editor`, organization/member/emergency management requires `admin`,
  and ownership transfer rules are restricted to `owner`.
- **Device API** — `Authorization: Bearer sgd_...` device token obtained once via
  pairing. Device routes live under `/device/...` and are scoped to the calling
  device only.

## Auth

| Method | Path             | Notes                                                                                                           |
| ------ | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/register` | `{ email, password, name, organizationName }`. Creates user + org (caller becomes `owner`). Rate-limited 5/min. |
| POST   | `/auth/login`    | `{ email, password }` → `{ token, user }`. Rate-limited 10/min.                                                 |
| GET    | `/auth/me`       | Current user profile.                                                                                           |

## Organizations & members

| Method | Path                             | Notes                                                                                                     |
| ------ | -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| GET    | `/orgs`                          | Organizations the caller belongs to (with role).                                                          |
| POST   | `/orgs`                          | `{ name }` — create another org; caller becomes `owner`.                                                  |
| GET    | `/orgs/:orgId`                   | Org detail.                                                                                               |
| PATCH  | `/orgs/:orgId`                   | `{ name }` — admin.                                                                                       |
| GET    | `/orgs/:orgId/members`           | Member list (`id, userId, email, name, role, createdAt`).                                                 |
| POST   | `/orgs/:orgId/members`           | `{ email, role }` — admin. Role cannot be `owner`; the user must already have an account (404 otherwise). |
| PATCH  | `/orgs/:orgId/members/:memberId` | `{ role }` — admin. The owner row is immutable; granting `owner` requires being `owner`.                  |
| DELETE | `/orgs/:orgId/members/:memberId` | Admin. The owner cannot be removed.                                                                       |

## Devices (screens)

| Method | Path                                                     | Notes                                                                                                          |
| ------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| GET    | `/orgs/:orgId/devices`                                   | All screens with online/sync status and latest metrics.                                                        |
| POST   | `/orgs/:orgId/devices`                                   | `{ name, ... }` — creates the screen **and returns a one-time pairing code**.                                  |
| GET    | `/orgs/:orgId/devices/:deviceId`                         | Detail (settings, status, last heartbeat, active command counts).                                              |
| PATCH  | `/orgs/:orgId/devices/:deviceId`                         | Update name, orientation, timezone, default playlist, group membership, etc. Changes bump the device manifest. |
| DELETE | `/orgs/:orgId/devices/:deviceId`                         | Soft delete; revokes the device token.                                                                         |
| POST   | `/orgs/:orgId/devices/:deviceId/regenerate-pairing-code` | Editor. New single-use code (invalidates the previous unused one).                                             |
| POST   | `/orgs/:orgId/devices/:deviceId/revoke-token`            | Invalidates the device token; the device must re-pair.                                                         |
| POST   | `/orgs/:orgId/devices/:deviceId/commands`                | `{ type, payload? }` — enqueue one of the command types below; pushed instantly over WS when connected.        |
| GET    | `/orgs/:orgId/devices/:deviceId/commands`                | Recent commands with status (`pending → sent → acked → completed/failed/expired`).                             |
| GET    | `/orgs/:orgId/devices/:deviceId/logs?limit=`             | Recent device logs.                                                                                            |
| GET    | `/orgs/:orgId/devices/:deviceId/heartbeats`              | Recent heartbeats (CPU, memory, disk, temperature, uptime).                                                    |
| GET    | `/orgs/:orgId/devices/:deviceId/playback-events`         | Recent playback start/end/error/skip events.                                                                   |
| GET    | `/orgs/:orgId/devices/:deviceId/screenshot`              | Latest screenshot (presigned URL + metadata). Request a fresh one with the `take_screenshot` command.          |

### Command types

`restart_player`, `reboot_device`, `refresh_content`, `clear_cache`,
`take_screenshot`, `identify`, `set_orientation`, `set_playlist`,
`update_settings`, `show_emergency`, `stop_emergency`, `send_logs`,
`health_check`, `software_update`.

## Device groups

| Method | Path                                  | Notes                                                                        |
| ------ | ------------------------------------- | ---------------------------------------------------------------------------- |
| GET    | `/orgs/:orgId/device-groups`          | Groups with `deviceCount`.                                                   |
| POST   | `/orgs/:orgId/device-groups`          | `{ name, description?, deviceIds? }`.                                        |
| GET    | `/orgs/:orgId/device-groups/:groupId` | Group + `deviceIds`.                                                         |
| PATCH  | `/orgs/:orgId/device-groups/:groupId` | `{ name?, description?, deviceIds? }` — `deviceIds` replaces the membership. |
| DELETE | `/orgs/:orgId/device-groups/:groupId` | Schedules targeting the group lose that target.                              |

## Media

| Method | Path                                                       | Notes                                                                                                                                    |
| ------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/orgs/:orgId/media`                                       | `multipart/form-data` upload. Validated by magic bytes; queued for FFmpeg processing. Returns the asset with `processingStatus=pending`. |
| GET    | `/orgs/:orgId/media?status=&type=&search=&page=&pageSize=` | Paged library with thumbnails (presigned URLs).                                                                                          |
| GET    | `/orgs/:orgId/media/:mediaId`                              | Asset detail incl. variants and processing error, if any.                                                                                |
| PATCH  | `/orgs/:orgId/media/:mediaId`                              | Rename / edit metadata.                                                                                                                  |
| DELETE | `/orgs/:orgId/media/:mediaId`                              | Soft delete. Blocked while referenced by playlists or emergency overrides.                                                               |
| POST   | `/orgs/:orgId/media/:mediaId/reprocess`                    | Re-enqueue processing (e.g. after a `failed` status).                                                                                    |

## Playlists

| Method | Path                                       | Notes                                                                                                                        |
| ------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/orgs/:orgId/playlists`                   | With item counts.                                                                                                            |
| POST   | `/orgs/:orgId/playlists`                   | `{ name, loop?, defaultImageDurationSeconds? }`.                                                                             |
| GET    | `/orgs/:orgId/playlists/:playlistId`       | Playlist + ordered items + media summaries.                                                                                  |
| PATCH  | `/orgs/:orgId/playlists/:playlistId`       | Update name/loop/default duration.                                                                                           |
| PUT    | `/orgs/:orgId/playlists/:playlistId/items` | Replace the full ordered item list: `{ items: [{ mediaId, durationSeconds?, fitMode?, enabled? }] }`. Media must be `ready`. |
| DELETE | `/orgs/:orgId/playlists/:playlistId`       | Blocked while used as a device default, in schedules, or in an active emergency.                                             |

## Schedules

| Method | Path                                           | Notes                                                                                                                                                                                                                                       |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/orgs/:orgId/schedules`                       | All schedules with targets.                                                                                                                                                                                                                 |
| POST   | `/orgs/:orgId/schedules`                       | `{ name, playlistId, enabled?, priority?, startDate?, endDate?, daysOfWeek?, startTime?, endTime?, timezone?, deviceIds?, groupIds? }`. Empty day set = every day; `startTime > endTime` = overnight window; no timezone = device timezone. |
| GET    | `/orgs/:orgId/schedules/preview?deviceId=&at=` | What a given screen would play at a given instant (runs the same resolver the device uses): `{ source: emergency\|schedule\|default\|none, ... }`.                                                                                          |
| GET    | `/orgs/:orgId/schedules/:scheduleId`           | Detail.                                                                                                                                                                                                                                     |
| PATCH  | `/orgs/:orgId/schedules/:scheduleId`           | Partial update; target arrays replace existing targets.                                                                                                                                                                                     |
| DELETE | `/orgs/:orgId/schedules/:scheduleId`           | Soft delete.                                                                                                                                                                                                                                |

## Emergency overrides

| Method | Path                                      | Notes                                                                                                                                                                         |
| ------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/orgs/:orgId/emergency`                  | Recent overrides, active first.                                                                                                                                               |
| POST   | `/orgs/:orgId/emergency`                  | Admin. Exactly one of `playlistId` / `mediaAssetId` (media must be `ready`), plus `appliesToAll` or explicit `deviceIds`/`groupIds`. Takes over targeted screens immediately. |
| POST   | `/orgs/:orgId/emergency/:overrideId/stop` | Ends the override; screens return to their normal schedule.                                                                                                                   |

## Device API (device-token auth)

| Method | Path                                 | Notes                                                                                                                                          |
| ------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/device/pair`                       | `{ pairingCode, hardwareInfo? }` → `{ token, deviceId, ... }`. Single use; rate-limited 10/min. The token is shown to the device exactly once. |
| GET    | `/device/ws`                         | WebSocket. Server pushes `command` and `sync_required` messages; device sends acks/heartbeats.                                                 |
| POST   | `/device/heartbeat`                  | System metrics, app version, current playback.                                                                                                 |
| GET    | `/device/sync`                       | `{ manifest, commands }` — the full per-device manifest (see [sync-protocol.md](sync-protocol.md)).                                            |
| POST   | `/device/sync-status`                | `{ status: downloading\|applied\|failed, manifestVersion, error? }`.                                                                           |
| POST   | `/device/logs`                       | Batched log upload from the device's ring buffer.                                                                                              |
| POST   | `/device/playback-events`            | Batched playback events.                                                                                                                       |
| POST   | `/device/screenshot`                 | Binary screenshot upload (response to `take_screenshot`).                                                                                      |
| GET    | `/device/commands`                   | Pending commands (polling fallback for WS).                                                                                                    |
| POST   | `/device/commands/:commandId/ack`    | Mark received.                                                                                                                                 |
| POST   | `/device/commands/:commandId/result` | `{ success, output?/error? }` — completes or fails the command.                                                                                |
| GET    | `/device/media/:mediaId/file`        | Streams a media file the device's manifest references (the manifest's `downloadPath` points here).                                             |
