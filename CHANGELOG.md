# Changelog

All notable changes to this project are documented here. The format is loosely
based on [Keep a Changelog](https://keepachangelog.com/).

## [0.3.0] — 2026-06-15

Multi-organization usability and organization branding. Additive on top of v0.2;
the migration (`20260615000000_org_logos`) only adds nullable logo columns to
`organizations` and changes no existing data.

### Added

- **Multi-organization switching** — sidebar organization switcher showing the
  active organization's logo, name and the caller's role, with a clear dropdown of
  all organizations the user belongs to. Switching remounts org-scoped pages so no
  stale data flashes. The active organization is persisted in `localStorage`.
- **Superadmin system context** — superadmins default to a "System / Superadmin"
  context with no active organization; they can open any organization (from the
  switcher or the companies list) and return to system context. Org-scoped
  navigation is hidden in system context.
- **Organization logos** — upload/replace/remove an SVG/PNG/JPG/JPEG logo (≤ 2 MB)
  per organization (`POST`/`DELETE /orgs/:orgId/logo`, admin/owner/superadmin).
  Logos render in the sidebar, switcher and superadmin companies list. Validated
  by content; SVGs are rejected if scriptable or network-active and are only shown
  via `<img>` (never inlined). Org responses now include `logoUrl`, `logoMimeType`
  and `logoUpdatedAt`.

### Fixed

- **Settings blank screen** — opening Settings as a superadmin with no active
  organization no longer renders blank; org-scoped sections show a clear no-org
  state, and a top-level error boundary prevents render errors from blanking pages.

## [0.2.0] — 2026-06-14

A feature upgrade on top of v1. All v1 behaviour is preserved; existing users,
organizations, devices, media, playlists, and schedules keep working after the
migration. The upgrade is additive — the v2 database migration
(`20260612000000_v2_folders_order_modes_superadmin`) only adds tables/columns and
backfills safe defaults, and does not drop data.

### Added

#### Media folders

- Organization-scoped, nestable `MediaFolder` model; media gains an optional
  `folderId`. Folders are a logical grouping only — no objects are moved in
  S3/MinIO when media is filed or folders are renamed/moved.
- Folder CRUD with cycle-safe moves, case-insensitive name uniqueness per parent,
  computed breadcrumb paths, and soft delete.
- Media browser folder sidebar/tree (`FolderTree`), breadcrumbs, "All media" and
  root views, upload into a folder, single and bulk move between folders, and
  filter/search across folders.
- Safe folder deletion with a usage summary (media count, subfolder count,
  playlist references, affected schedules) and a choice of strategy: move
  contents to root, move to another folder, or soft-delete contents.

#### Playlists

- **Dynamic folder entries** — a playlist item can reference a folder instead of
  a single media asset. Folder contents resolve at sync/preview time, so media
  added to or removed from the folder is reflected automatically. Supports
  include-subfolders, and media-type / orientation filters.
- **Playback order modes** — `manual_order` (default), `alphabetical`
  (case-insensitive natural sort, `file2` before `file10`), `random` (no
  immediate repeats, reshuffle per cycle), and `random_with_priority_rules`.
- **Priority rules** — "after every X normal items, play one item from this
  group". Per-playlist `PlaylistPriorityRule` with `rotate`/`random` selection
  and many media/folder assignments; multiple rules per playlist with
  deterministic tie-breaking. Inactive unless the playlist is in
  `random_with_priority_rules` mode.
- **Resolved preview** (`GET …/resolved-preview`) — shows exactly what devices
  will receive: resolved media count, estimated duration, per-item source
  (direct item / folder / priority rule), sample sequences for random modes
  (regenerable via `seed`), and warnings (empty folder, processing/failed media,
  orientation mismatch, empty/inactive priority rules).
- **Clone** (`POST …/clone`) — duplicates settings, items, folder entries,
  priority rules and assignments (never schedules or history); records
  `clonedFromPlaylistId`/`clonedAt`.

#### Media play counts & safe delete

- Play metrics derived from `PlaybackEvent`s: total play count and last-played in
  the library; total/first/last and per-device/per-playlist breakdowns in the
  detail endpoint (`GET …/media/:id/playback-stats`).
- Media usage endpoint (`GET …/media/:id/usage`) backs safe-delete warnings;
  delete and bulk-delete are soft deletes that drop playlist/priority references
  and conservatively keep storage objects for later cleanup.

#### Superadmin, accounts & audit

- **Public registration removed.** The dashboard no longer offers account
  creation; `POST /auth/register` now returns `410 Gone`. Existing users are
  preserved.
- **Install-time superadmin** via `INITIAL_SUPERADMIN_EMAIL` / `_PASSWORD`
  (min 12 chars) / `_NAME`, created on startup only if no superadmin exists
  (never overwritten, password never logged). CLI: `pnpm app:create-superadmin`
  and `pnpm app:reset-superadmin-password`.
- **Superadmin dashboard & API** (`/superadmin/*`) — manage organizations
  (create/update/disable, with device/user/media/storage counts), users
  (create with temporary password + forced change, disable, reset password), and
  org memberships/roles.
- `User.globalRole` (`user`/`superadmin`), `User.disabledAt`,
  `User.mustChangePassword`; first-login forced password change; disabled users
  and disabled organizations are blocked at auth.
- **Audit log** (`AuditLog`) for superadmin and destructive actions (logins, org/
  user lifecycle, password resets, role changes, media/folder/playlist deletes,
  clones, priority-rule changes); never records passwords.

#### Sync protocol v2

- `SYNC_PROTOCOL_VERSION` bumped to **2**. Manifests now carry
  `playbackOrderMode`, resolved folder entries (with `source`/`sourceFolderId`/
  `sourceFolderPath` for display), and `priorityRules` with assignments resolved
  to concrete ready-media ids — so devices play folder/random/priority playlists
  fully offline without backend access.
- Device agent/player playback engine (`@signage/shared` `PlaybackQueueEngine`)
  implements all order modes and priority insertion offline, with seeded RNG for
  deterministic previews.
- Playback events are idempotent via client-generated ids, so offline events sync
  later without double-counting.

### Changed

- Playlist items gained `type`, `folderId`, `includeSubfolders`,
  `filterMediaType`, `filterOrientation`; existing items backfill to
  `type = media`, positions preserved.
- Organizations gained `status`, `planName`, `maxDevices`, `maxStorageGb`.
- Documentation updated across `README.md` and `docs/` (API, sync protocol,
  architecture).

### Migration notes

- Run `pnpm db:migrate` (or `docker compose` startup) to apply
  `20260612000000_v2_folders_order_modes_superadmin`.
- Set the `INITIAL_SUPERADMIN_*` variables (see `.env.example`) before first
  start, or create the superadmin afterwards with `pnpm app:create-superadmin`.
- Devices on the v1 agent keep playing cached content; update agents to consume
  v2 manifests (folder/random/priority playback). Older agents that see
  protocol version 2 report a sync error and keep their last applied content
  rather than guessing.

## [0.1.0] — 2026-06-11

- Initial release of the Hamfield Signage platform.
