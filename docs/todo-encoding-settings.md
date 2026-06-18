# TODO: UI-configurable video encoding settings ("Step 2")

A future feature, not yet implemented. Paste the prompt below into a fresh
Claude Code session when ready to build it — it is intentionally self-contained
(restates all context and file locations) because a new session has no memory of
the discussion that produced it.

Quick win that was deliberately skipped (Step 1): exposing only the FFmpeg
`-preset` as a `VIDEO_PRESET` env var. We chose to skip it and go straight to the
full UI feature below.

---

## Implementation prompt

```text
Implement UI-configurable video encoding settings ("Step 2") for the Hamfield
Signage platform.

GOAL
Let a superadmin set the video transcoding parameters from the dashboard instead
of via environment variables. Settings are system-wide (NOT per-organization) and
apply to NEW uploads only (already-processed media keeps its existing variant).

BACKGROUND — how transcoding works today
- The worker reads encoding config from env at BOOT via apps/worker/src/env.ts
  (getEnv() is cached once at startup): MAX_VIDEO_HEIGHT, VIDEO_BITRATE_KBPS,
  FALLBACK_VIDEO_BITRATE_KBPS, CREATE_FALLBACK_VARIANT.
- The FFmpeg preset is HARDCODED as "-preset medium" in
  packages/media/src/transcode.ts (buildTranscodeArgs).
- The transcode pipeline lives in apps/worker/src/processor.ts (processVideo uses
  buildTranscodeArgs; the fallback variant is gated by CREATE_FALLBACK_VARIANT).
- There is NO settings table yet; config is env-only.
- The repo already has a clean precedence-based settings resolver to copy:
  resolveDisplaySettings in packages/shared/src/display.ts (interface ~line 78,
  resolver ~line 107, tests in packages/shared/src/display.test.ts).
- API routes are registered in apps/api/src/server.ts under prefix /api/v1,
  including superadminRoutes (superadmin-only surface). DB schema is
  packages/database/prisma/schema.prisma (Organization ~line 154, MediaAsset
  ~line 343, role enum includes `superadmin`). Web pages are in
  apps/web/src/pages/ (e.g. OrgSettings.tsx is a good UI reference).

WHAT TO BUILD
1. DB: add a singleton SystemSettings model (one row) via a Prisma migration, with
   columns videoPreset, maxVideoHeight, videoBitrateKbps, createFallbackVariant,
   fallbackVideoBitrateKbps. All nullable; null means "use the env/hardcoded
   default". Provide a helper to read-or-create the single row.
2. Shared: add resolveEncodingSettings(dbSettings, envDefaults) +
   zod validation, mirroring resolveDisplaySettings. Precedence: DB value -> env
   default -> hardcoded default. Bounds must match apps/worker/src/env.ts
   (maxVideoHeight min 240; bitrates min 250). videoPreset must be one of the
   x264 presets: ultrafast, superfast, veryfast, faster, fast, medium, slow,
   slower, veryslow.
3. transcode.ts: make buildTranscodeArgs accept a `preset` option (default
   "medium") instead of hardcoding it.
4. Worker: in apps/worker/src/processor.ts, load SystemSettings from the DB at
   JOB TIME (not from cached boot env) and resolve effective settings via
   resolveEncodingSettings, then pass them into buildTranscodeArgs. The Prisma
   client is already available in the processor. This is the key change: UI edits
   must take effect on the next upload with no worker restart.
5. API: add GET and PUT /api/v1/system/encoding-settings, superadmin-only,
   validated with the shared zod schema. Follow the existing superadminRoutes
   auth/guard pattern.
6. Web: add a superadmin "System / Encoding" settings page (sibling of
   OrgSettings.tsx): preset dropdown, max height, target bitrate, fallback toggle
   + fallback bitrate. Show a clear note: "Applies to new uploads only." Wire it
   to the new endpoints.

CONSTRAINTS / DECISIONS
- Scope is system-wide + superadmin-only (encoding is a CPU/cost lever; do not
  expose it per-tenant). If you think per-org-with-caps is clearly better, raise
  it before implementing — otherwise proceed system-wide.
- Keep env vars working as the defaults/fallback (don't break existing deploys).
- Add/extend unit tests for the resolver (copy the display.test.ts style).

VERIFY
- pnpm build / typecheck and run the test suite.
- Confirm `docker compose -f docker-compose.example.yml config` still parses.
- Sanity-check the migration applies cleanly (prisma migrate).

GIT
- Follow the repo conventions: commit on master (solo workflow), Co-Authored-By
  trailer, and push only after I confirm. Show me the diff/plan first.
```
