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

| Method | Path                    | Notes                                                                                                                                              |
| ------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/register`        | **Disabled.** Public registration was removed in v2; always returns `410 Gone`. Accounts are created by a superadmin or an org admin.              |
| POST   | `/auth/login`           | `{ email, password }` → `{ token, user, organizations }`. Rejects disabled accounts. Rate-limited 10/min. Superadmin logins are audit-logged.      |
| GET    | `/auth/me`              | Current user profile + organizations. Rejects disabled accounts.                                                                                   |
| POST   | `/auth/change-password` | Authenticated. `{ currentPassword, newPassword }`; clears `mustChangePassword`. New password must differ from the current one. Rate-limited 5/min. |

Users created with a temporary password have `mustChangePassword=true`; the
dashboard forces a password change before any other action.

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

| Method | Path                                         | Notes                                                                                                                                                            |
| ------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/orgs/:orgId/media?folderId=`               | `multipart/form-data` upload. Optional `folderId` files it into a folder. Validated by magic bytes; queued for FFmpeg processing (`processingStatus=pending`).   |
| GET    | `/orgs/:orgId/media`                         | Paged library with thumbnails, play counts, and folder paths. Query: `status, type, orientation, search, folderId, usedInPlaylist, sort, order, page, pageSize`. |
| GET    | `/orgs/:orgId/media/:mediaId`                | Asset detail incl. variants, processing error, play count, last played.                                                                                          |
| PATCH  | `/orgs/:orgId/media/:mediaId`                | Rename and/or move to another folder (`{ name?, folderId? }`; `folderId: null` = root).                                                                          |
| POST   | `/orgs/:orgId/media/bulk-move`               | `{ mediaIds, folderId }` — move many at once → `{ moved }`.                                                                                                      |
| GET    | `/orgs/:orgId/media/:mediaId/usage`          | Safe-delete summary: playlists/folder-entries/priority-rules referencing it, affected schedules, play count.                                                     |
| GET    | `/orgs/:orgId/media/:mediaId/playback-stats` | Totals + first/last played + top devices/playlists.                                                                                                              |
| DELETE | `/orgs/:orgId/media/:mediaId`                | Soft delete. Drops direct playlist/priority references; storage objects kept for later cleanup. Call `usage` first to warn.                                      |
| POST   | `/orgs/:orgId/media/bulk-delete`             | `{ mediaIds }` — soft-delete many → `{ deleted }`.                                                                                                               |
| POST   | `/orgs/:orgId/media/:mediaId/reprocess`      | Re-enqueue processing (e.g. after a `failed` status).                                                                                                            |

`folderId` filter accepts a folder id (that folder only), `root` (unfiled media),
or absent (all media). `sort` is one of `name, createdAt, updatedAt, type,
orientation, duration, playCount`.

## Media folders

Folders are organization-scoped, nestable, and a purely logical grouping — moving
or renaming a folder never moves storage objects, and playlists reference folders
by id so they survive renames/moves.

| Method | Path                                         | Notes                                                                                                                         |
| ------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/orgs/:orgId/media/folders`                 | Flat list with computed `path`, `mediaCount`, `subfolderCount`. The dashboard builds the tree client-side.                    |
| POST   | `/orgs/:orgId/media/folders`                 | `{ name, parentFolderId? }` — editor. Names are unique (case-insensitive) within a parent.                                    |
| PATCH  | `/orgs/:orgId/media/folders/:folderId`       | `{ name?, parentFolderId? }` — rename and/or move. Moving into itself or a descendant is rejected.                            |
| GET    | `/orgs/:orgId/media/folders/:folderId/usage` | Safe-delete summary: media count, subfolder count, playlist references, affected schedules.                                   |
| DELETE | `/orgs/:orgId/media/folders/:folderId`       | `{ strategy: move_to_root \| move_to_folder \| delete_media, targetFolderId? }` — soft delete; handles contents per strategy. |

## Playlists

| Method | Path                                                  | Notes                                                                                                                                                                                            |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/orgs/:orgId/playlists`                              | With item counts.                                                                                                                                                                                |
| POST   | `/orgs/:orgId/playlists`                              | `{ name, description?, loop?, defaultImageDurationSeconds?, playbackOrderMode?, items? }`.                                                                                                       |
| GET    | `/orgs/:orgId/playlists/:playlistId`                  | Playlist + ordered items (media or folder entries) + media summaries with thumbnails.                                                                                                            |
| PATCH  | `/orgs/:orgId/playlists/:playlistId`                  | Update name/description/loop/default duration/`playbackOrderMode`.                                                                                                                               |
| PUT    | `/orgs/:orgId/playlists/:playlistId/items`            | Replace the full ordered list. Each item is `{ type: media\|folder, mediaAssetId?, folderId?, durationSeconds?, fitMode?, enabled?, includeSubfolders?, filterMediaType?, filterOrientation? }`. |
| POST   | `/orgs/:orgId/playlists/:playlistId/clone`            | `{ name? }` — duplicate items, folder entries, and priority rules (not schedules/history). Defaults to "Copy of …". → `201`.                                                                     |
| GET    | `/orgs/:orgId/playlists/:playlistId/resolved-preview` | What devices will receive after resolution. Query `seed`, `sampleSize`. Returns resolved items (with `source`), duration, a sample sequence for random modes, and warnings.                      |
| DELETE | `/orgs/:orgId/playlists/:playlistId`                  | Blocked while used as a device default or in schedules. Soft delete.                                                                                                                             |

`playbackOrderMode` is one of `manual_order` (default), `alphabetical`, `random`,
`random_with_priority_rules`. Folder entries resolve dynamically: media added to /
removed from a folder is reflected automatically; folder rename/move never breaks
the playlist.

## Playlist priority rules

Priority rules apply only when `playbackOrderMode = random_with_priority_rules`:
after every `intervalCount` normal items, one item from the rule's assignments is
inserted. Multiple rules per playlist are allowed; simultaneous triggers are
broken deterministically (lowest interval, then position, then creation time).

| Method | Path                                                                    | Notes                                                                                                                                                                        |
| ------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/orgs/:orgId/playlists/:playlistId/priority-rules`                     | Rules with resolved assignments and folder paths.                                                                                                                            |
| POST   | `/orgs/:orgId/playlists/:playlistId/priority-rules`                     | `{ name, intervalCount, selectionMode: rotate\|random, enabled?, position?, assignments? }`. → `201`.                                                                        |
| PATCH  | `/orgs/:orgId/playlists/:playlistId/priority-rules/:ruleId`             | Update name/interval/selection/enabled/position.                                                                                                                             |
| DELETE | `/orgs/:orgId/playlists/:playlistId/priority-rules/:ruleId`             | Soft delete.                                                                                                                                                                 |
| PUT    | `/orgs/:orgId/playlists/:playlistId/priority-rules/:ruleId/assignments` | Replace assignments: `{ assignments: [{ mediaAssetId? \| folderId?, includeSubfolders? }] }` (exactly one of media/folder each). Used to assign many selected files at once. |

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

## Superadmin

Platform-level administration. Every route requires an authenticated, active user
whose `globalRole` is `superadmin`; non-superadmins get `403`. All mutating
actions are written to the audit log.

| Method | Path                                                     | Notes                                                                                                      |
| ------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GET    | `/superadmin/organizations`                              | All orgs with `deviceCount`, `userCount`, `mediaCount`, `storageUsedBytes`.                                |
| POST   | `/superadmin/organizations`                              | `{ name, slug?, status?, planName?, maxDevices?, maxStorageGb? }` — slug auto-generated if omitted. `201`. |
| PATCH  | `/superadmin/organizations/:orgId`                       | Update name/status/plan/limits. Status changes log enable/disable.                                         |
| GET    | `/superadmin/users`                                      | All users with global role, disabled state, and memberships.                                               |
| POST   | `/superadmin/users`                                      | `{ name, email, password, mustChangePassword?, memberships: [{ organizationId, role }] }`. `201`.          |
| PATCH  | `/superadmin/users/:userId`                              | `{ name?, disabled? }`. Superadmin accounts cannot be disabled from the dashboard.                         |
| POST   | `/superadmin/users/:userId/reset-password`               | `{ password, mustChangePassword? }`.                                                                       |
| POST   | `/superadmin/organizations/:orgId/members`               | `{ userId, role }` — add an existing user to an org. `201`.                                                |
| PATCH  | `/superadmin/organizations/:orgId/members/:membershipId` | `{ role }`.                                                                                                |
| DELETE | `/superadmin/organizations/:orgId/members/:membershipId` | Remove a membership. `204`.                                                                                |
| GET    | `/superadmin/audit-logs?page=&pageSize=`                 | Paged audit log (actor, action, target, metadata, IP, timestamp).                                          |

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
