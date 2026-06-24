# TODO: video encoding — per-device tiers + UI-configurable settings

Two related, not-yet-implemented features for the video transcoding pipeline.
Paste the relevant implementation prompt into a fresh Claude Code session when
ready — each is intentionally self-contained (restates context + file
locations) because a new session has no memory of the discussion that produced
it. **Feature A (device tiers) should be built first**; Feature B layers on top.

## Already shipped (context — do NOT re-do)

- **Frame-rate cap fix.** `packages/media/src/transcode.ts` `buildTranscodeArgs`
  now takes `maxFrameRate` + `sourceFrameRate` (decimates only sources above the
  cap) and a `profile` option, and no longer pins an explicit `-level` (x264
  computes the level so it always matches the stream — an uncapped 50/60 fps clip
  at a 30 fps level is what made the Raspberry Pi show a white frame).
  `packages/media/src/probe.ts` now returns `frameRate`. `apps/worker/src/processor.ts`
  passes `MAX_VIDEO_FPS` (default 30) into both the main and fallback transcodes;
  the fallback uses `profile: 'main'`.
- **Bulk reprocess CLI.** `apps/api/src/cli/reprocess-media.ts`
  (`node apps/api/dist/cli/reprocess-media.js [orgId] [--images]`) re-enqueues
  existing media. Feature A must extend it to backfill new tiers.

---

## Feature A — Per-device encoding tiers ✅ SHIPPED 2026-06-24

Implemented across shared/media/db/worker/api/agent/web. Key pieces as built:

- **Shared:** `PLAYBACK_PROFILES`/`PlaybackProfile`, `video_high|standard|light`
  added to `MEDIA_VARIANT_KINDS`, `videoVariantKindForProfile`,
  `suggestPlaybackProfile`, `DEFAULT_PLAYBACK_PROFILE` (`packages/shared/src/`).
- **Media:** `VIDEO_TIERS` + `tierTranscodeOptions` (`packages/media/src/transcode.ts`).
- **DB:** migration `20260624000000_per_device_encoding_tiers` — `PlaybackProfile`
  enum, `Device.playbackProfile` (default `standard`), `Device.deviceModel`,
  enum ADD VALUE for the three video kinds.
- **Worker:** `processVideo` generates only the org's in-use tiers (distinct
  `Device.playbackProfile`, always incl. `standard`); standard → processed
  columns, others → `MediaVariant`; prunes unused/legacy variants. Old
  `CREATE_FALLBACK_VARIANT` path removed.
- **API:** `selectVideoVariant` (`apps/api/src/lib/media-variant.ts`, unit-tested)
  used by both `manifest.ts` (per-device tier checksum/size) and the device file
  endpoint (serves the device-profile tier).
- **Device CRUD/DTO:** `playbackProfile` + `deviceModel` through schemas,
  `DeviceDto`, `serializeDevice`, device create/update handlers.
- **Agent:** `readDeviceModel()` (`/proc/device-tree/model`) reported via
  heartbeat + pairing; stored on `Device.deviceModel`.
- **Dashboard:** video-quality-tier dropdown in `DeviceDetail` with the
  hardware-derived "(suggested)" hint.
- **Backfill:** `reprocess-media` CLI regenerates the now-in-use tiers; re-run it
  after adding a screen of a new hardware class. No automatic reconcile job yet —
  adding a new-profile device leaves it on the `standard` fallback until reprocess.

### Goal

Encode each video into one of several quality **tiers** and serve each device the
tier its hardware can handle, while **minimising R2 storage** by only generating
tiers the fleet actually uses. Hardware in play: beefy players, Raspberry Pi 4
(mid), ODROID C4 (weak — needs the lightest version).

### Confirmed decisions

- **Tiers** (fixed presets; define once, e.g. `VIDEO_TIERS` in
  `packages/media/src/transcode.ts`, keyed by profile):

  | Tier (`PlaybackProfile`) | Target device  | maxHeight | maxFps | bitrate | H.264 profile |
  | ------------------------ | -------------- | --------- | ------ | ------- | ------------- |
  | `high`                   | beefy players  | 1080      | 60     | 9000k   | high          |
  | `standard` (default)     | Raspberry Pi 4 | 1080      | 30     | 6000k   | high          |
  | `light`                  | ODROID C4      | 720       | 30     | 2500k   | main          |

- **Device → tier:** a per-device dropdown in the dashboard **plus** an
  auto-suggested default derived from the device's reported hardware.
- **Generation: lazy.** When processing a video, generate only the tiers whose
  profile is used by ≥1 device in that org (distinct `Device.playbackProfile`).
  Adding a device with a new profile must backfill the missing tier (reconcile /
  via the reprocess CLI). **Keep originals** so any tier can be regenerated.

### How transcoding/serving works today (read before building)

- `apps/worker/src/processor.ts` `processVideo`: transcodes the original to one
  "processed" MP4, uploads it, sets `MediaAsset.processedStorageKey` /
  `processedMimeType` / `processedSizeBytes` / `checksumSha256`. If
  `CREATE_FALLBACK_VARIANT`, it also writes a 720p `MediaVariant` of kind
  `fallback` (this is effectively today's "light" — repurpose it).
- `MediaVariant` (schema ~line 384): `@@unique([mediaAssetId, kind])`,
  `kind: MediaVariantKind` enum currently `original | processed | fallback | thumbnail`
  (schema ~line 71). Has `storageKey, mimeType, width, height, bitrateKbps,
sizeBytes, checksumSha256`.
- Device download: `apps/api/src/routes/device-api.ts` ~line 309
  `GET /device/media/:mediaId/file?variant=` — currently serves
  `processedStorageKey ?? originalStorageKey` (or thumbnail/original by query),
  presigns R2, 302-redirects. The route authenticates the device, so it knows the
  device's profile.
- Manifest: `apps/api/src/lib/manifest.ts` `addMedia` (~line 310) sets each media
  entry's `checksum`/`sizeBytes`/`mimeType` from the **processed** columns. The
  agent caches by `mediaId + checksum` and verifies the downloaded file's sha256
  against the manifest checksum, so the manifest MUST advertise the
  tier-specific checksum/size for the device's profile (the manifest is already
  built per-device).

### What to build

1. **Shared:** add `PLAYBACK_PROFILES = ['high','standard','light']` + type
   `PlaybackProfile` to `packages/shared/src/enums.ts`. Add a single source-of-truth
   selection helper, e.g. `videoVariantKindForProfile(profile)` →
   `'video_high' | 'video_standard' | 'video_light'`.
2. **Media presets:** `VIDEO_TIERS` map (table above) in
   `packages/media/src/transcode.ts`; a helper that turns a tier into
   `buildTranscodeArgs` options.
3. **DB (generate via `prisma migrate dev`, or `prisma migrate diff
--from-schema-datamodel <old> --to-schema-datamodel <new> --script` if no dev DB —
   do NOT hand-write; the table is `@@map("devices")` and enum types are
   PascalCase):**
   - new enum `PlaybackProfile { high standard light }`;
   - `Device.playbackProfile PlaybackProfile @default(standard)`;
   - add `video_high video_standard video_light` to `MediaVariantKind` (precedent
     for enum ADD VALUE: `migrations/20260616000000_display_settings` used
     `ALTER TYPE "FitMode" ADD VALUE IF NOT EXISTS 'scale_down'`).
   - Keep `MediaAsset.processedStorageKey` as the **standard** tier (back-compat +
     fallback); store non-standard tiers as `MediaVariant` rows. Avoid double-
     storing standard.
4. **Worker (`processVideo`):** compute `tiersInUse` =
   `distinct Device.playbackProfile WHERE organizationId = media.org AND deletedAt IS NULL`
   (always include `standard` as the safe default/fallback). For each tier:
   transcode with its preset (+ `sourceFrameRate` from probe). Standard →
   `processedStorageKey`; others → upsert a `MediaVariant` (kind `video_<tier>`)
   with its own checksum/size. Remove the old `CREATE_FALLBACK_VARIANT` path.
5. **Selection helper (API):** `selectVideoVariant(media, variants, profile)` →
   `{ storageKey, checksum, sizeBytes, mimeType }` with fallback chain
   **requested tier → standard (processed) → original**. Use it in BOTH:
   - `manifest.ts addMedia` (pass the device's profile so checksum/size match), and
   - `device-api.ts` file endpoint (derive tier from the authenticated device's
     profile) — so the served file always matches the manifest checksum.
6. **Device CRUD:** add `playbackProfile` to `createDeviceSchema` /
   `updateDeviceSchema` (`packages/shared/src/schemas.ts`), the `set_orientation`/
   settings flows if relevant, `serializeDevice` (`apps/api/src/lib/serializers.ts`),
   `DeviceDto` (`packages/shared/src/types.ts`), and the create/update handlers in
   `apps/api/src/routes/devices.ts`.
7. **Hardware auto-suggest:** the agent currently reports only
   `osInfo = "${os.type()} ${os.release()}"` and `archInfo = os.arch()`
   (`apps/agent/src/metrics.ts` ~line 33) — these do NOT contain the board model,
   so add a `deviceModel` field read from `/proc/device-tree/model` (fallback
   `/sys/firmware/devicetree/base/model`) on Linux, thread it through the
   heartbeat → `Device` (new nullable column) → `DeviceDto`. Then in the dashboard
   compute a suggested tier: model contains "ODROID"/"C4"/Amlogic → `light`;
   "Raspberry Pi 5"/x86_64/strong → `high`; "Raspberry Pi 4" → `standard`; else
   `standard`. The suggestion is a UI hint (e.g. "Suggested: light"), the dropdown
   value still wins.
8. **Dashboard:** add the playback-profile dropdown to `DeviceDetail.tsx`
   (near Orientation/Rotation), showing the suggested tier; persist via the
   existing device PATCH.
9. **Backfill:** extend `apps/api/src/cli/reprocess-media.ts` so reprocessing
   regenerates the now-in-use tiers; document that adding a device of a new class
   means re-running it (or implement an automatic reconcile job that enqueues
   reprocessing for media a newly-profiled device will play).

### Verify

- `pnpm -r typecheck && pnpm -r test && pnpm -r build`.
- Migration applies cleanly; a `standard` device still plays after upgrade
  (back-compat via `processedStorageKey`).
- A `light` device downloads the smaller file; manifest checksum matches the
  served file (agent sha256 verification passes).

---

## Feature B — UI-configurable encoding settings ("Step 2")

Layer this ON TOP of Feature A: instead of a single global config, let a
superadmin edit the **tier presets** (and the x264 `-preset`) from the dashboard.
If Feature A isn't built yet, this degrades to editing the single processed
profile. Settings are system-wide (NOT per-org) and apply to NEW uploads only.

Quick win deliberately skipped (Step 1): exposing only the FFmpeg `-preset` as a
`VIDEO_PRESET` env var — we chose to go straight to the UI feature.

### Implementation prompt

```text
Implement UI-configurable video encoding settings ("Step 2") for the Hamfield
Signage platform. If the per-device tier system (Feature A) exists, make these
settings edit the TIER PRESETS (per-tier maxHeight/fps/bitrate/profile + a shared
x264 preset); otherwise fall back to a single processed profile.

GOAL
Let a superadmin set the video transcoding parameters from the dashboard instead
of via environment variables. Settings are system-wide (NOT per-organization) and
apply to NEW uploads only (already-processed media keeps its existing variant;
use the reprocess CLI to apply changes to existing media).

BACKGROUND — how transcoding works today
- The worker reads encoding config from env at BOOT via apps/worker/src/env.ts
  (getEnv() is cached once at startup): MAX_VIDEO_HEIGHT, VIDEO_BITRATE_KBPS,
  MAX_VIDEO_FPS, FALLBACK_VIDEO_BITRATE_KBPS, CREATE_FALLBACK_VARIANT.
- The FFmpeg preset is HARDCODED as "-preset medium" in
  packages/media/src/transcode.ts (buildTranscodeArgs).
- The transcode pipeline lives in apps/worker/src/processor.ts (processVideo).
- There is NO settings table yet; config is env-only.
- Copy the precedence-based resolver pattern: resolveDisplaySettings in
  packages/shared/src/display.ts (interface ~line 78, resolver ~line 107, tests in
  packages/shared/src/display.test.ts).
- API routes register in apps/api/src/server.ts under /api/v1 incl. superadminRoutes.
  DB schema: packages/database/prisma/schema.prisma. Web pages in
  apps/web/src/pages/ (OrgSettings.tsx is a good UI reference).

WHAT TO BUILD
1. DB: a singleton SystemSettings model (one row) via a Prisma migration (videoPreset
   + per-tier params, all nullable; null = use env/hardcoded default). Helper to
   read-or-create the row.
2. Shared: resolveEncodingSettings(dbSettings, envDefaults) + zod validation,
   mirroring resolveDisplaySettings. Precedence DB -> env -> hardcoded. Bounds match
   apps/worker/src/env.ts (maxVideoHeight min 240; bitrates min 250; fps 1..120).
   videoPreset in {ultrafast,superfast,veryfast,faster,fast,medium,slow,slower,veryslow}.
3. transcode.ts: buildTranscodeArgs already takes most options; add `preset`
   (default "medium").
4. Worker: load SystemSettings from the DB at JOB TIME (not cached boot env) and
   resolve effective settings, then pass into buildTranscodeArgs — UI edits take
   effect on the next upload with no worker restart. Prisma is available in the processor.
5. API: GET + PUT /api/v1/system/encoding-settings, superadmin-only, zod-validated.
6. Web: a superadmin "System / Encoding" page (sibling of OrgSettings.tsx) with the
   tier/preset fields and a clear "Applies to new uploads only" note + a link/hint to
   the reprocess CLI for existing media.

CONSTRAINTS
- System-wide + superadmin-only (encoding is a CPU/cost lever; not per-tenant).
- Keep env vars working as defaults/fallback.
- Add resolver unit tests (copy display.test.ts style).

VERIFY
- pnpm build / typecheck / test. `docker compose -f docker-compose.example.yml config`
  still parses. Migration applies cleanly (prisma migrate dev, not hand-written).

GIT
- Repo conventions: short-lived branch -> fast-forward into master -> push; no PR.
  Co-Authored-By trailer. Show the plan/diff first.
```
