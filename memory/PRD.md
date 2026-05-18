# LiveWatch (NovaStream) — PRD

## Original Problem
French live-TV streaming app (Vavoo-backed). User reported flaky UX (no loader, broken logos, broken playback) on top of an existing MVP. Iterations focused on UX polish + real engagement metrics + smart fallbacks for missing assets.

## Tech Stack
- Backend: FastAPI + Motor (MongoDB) + httpx; runs on 8001 (supervisor)
- Frontend: React 18 + Tailwind + craco + hls.js; runs on 3000 (supervisor)
- DB: MongoDB (catalog cache in memory; `views` collection persists w/ 24h TTL)
- Streaming source: vavoo.to / kool.to via signed `addonSig` ping → HLS

## Architecture
- `/app/backend/server.py` — single-file FastAPI:
  - `/api/channels` (filter by country/category/search) → includes `quality`, `logo`, `viewers` per channel
  - `/api/countries`, `/api/categories`
  - `/api/stream/{id}` → resolve & proxy + record a view event
  - `/api/hls?u=…` → micro-cached HLS playlist proxy + raw segment passthrough
  - `/api/stats` → `{ total_24h, live_total }`
  - `/api/v1/public/*` → external integrator endpoints
- `/app/frontend/src/pages/NovaStream.jsx` — main page
- `/app/frontend/src/components/{ChannelCard, VideoPlayer, AdUnlockModal}.jsx`

## What's Been Implemented (latest first)
### 2026-02 (current session)
- Real channel **logos** via `github.com/tv-logo/tv-logos` (~200 FR + many other countries). Index built at startup; per-channel lookup is in-memory O(1); fallback to TV icon when no slug match.
- **Quality tag** (HD/FHD/4K/UHD) detected from channel name, color-coded (blue / violet / gold).
- **View tracking** in MongoDB (`views` collection, TTL 24 h, idx on `ts` and `(channel_id, ts)`). Aggregated to a memo-cached stats object (`live_total`, `total_24h`, `per_channel`).
- New **`/api/stats`** endpoint; FE polls every 20 s.
- Header pill: **`X VUES / 24 H`**. Hero strip: **`X en direct`** pulse-dot pill.
- Per-card **viewers badge** (eye icon + count, last 5 min window).
- Player kebab **menu cleaned**: removed Vitesse; added "Recharger le flux"; Qualité auto-hidden when only one HLS level.
- Retry now gives **immediate visual feedback** (loading state reset before parent re-resolves).
- **Grid fluidity** boost: removed `backdrop-filter` from per-card glass, `content-visibility: auto`, `React.memo(ChannelCard)`.
- Loader state on initial channel fetch and on filter change (no more flash of empty-state text).

### Earlier
- Stable per-channel IDs (md5 of upstream URL) to fix React key collisions.
- HLS playlist micro-cache (2 s) + per-channel resolve lock to coalesce 1000+ viewers into 1 upstream call.
- Embed page + public `/api/v1/public/*` namespace.
- Ad-unlock flow before play.

## Data Models
- `channel` (in-memory): `{ id, url, name, source, quality, logo, group, country, categories }`
- `views` (Mongo): `{ channel_id, ts }` — TTL 24 h
- `/api/channels` response item: `{ id, name, source, quality, logo, country, categories, viewers }`

## Key Env
- `MONGO_URL`, `DB_NAME` (backend/.env — never touch)
- `REACT_APP_BACKEND_URL` (frontend/.env — never touch)

## Backlog (P0/P1/P2)
- **P1** Strip resolution suffixes (`HD`/`FHD`/`4K`) from displayed channel name (currently shown both on card text and as a tag → mildly redundant).
- **P1** Auto-retry on Vavoo signature expiry: when `/api/hls` returns 4xx, FE should re-call `/api/stream/{id}` automatically once.
- **P1** Pagination / virtualized grid for very-long lists (mobile bas de gamme).
- **P2** Better logo slug variants (handle `& -> and`, plurals, French language markers) to bump match rate above the current ~25 %.
- **P2** Curated "popular / recommandé" carousel at the top (top 10 sport+info).
- **P2** Persist views as time-bucketed counters to avoid full-collection count on 1000s of viewers (current implementation is fine up to ~50 k events / 24 h).
- **P2** Per-country viewer breakdown in `/api/stats`.

## Known Limitations
- Upstream Vavoo signed URLs expire ~5 min → user might need to "Recharger le flux" occasionally (now in kebab).
- Many channels have no match in the tv-logos repo (e.g. "A LA CARTE 1 HD", "BACKUP ONLY") — they show TV icon by design.
- Total 24 h is "view events" not "unique users" (we don't track sessions).

## Session 2026-02-18 — Supabase integration + global favorites sync
- **Multiview (1×2 / 2×2 / 3×3 / 4×4)** with iframe embed mode (modal + player flow).
- **HLS single-flight optimization** in `/app/backend/server.py` (asyncio.Task + shield); load-tested with 1000 concurrent viewers on same channel → zero extra upstream calls.
- **Supabase integration** (`@supabase/supabase-js`):
  - `AuthProvider` in `/app/frontend/src/context/AuthContext.jsx` with `.maybeSingle()`, 3-second `Promise.race` on profile fetch, and 5-second safety `setTimeout` so the UI never hangs on Loader2.
  - `signUp` performs a best-effort upsert into `user_profiles` (safety net if no `handle_new_user` DB trigger exists).
  - Pages: `/login`, `/dashboard`, `/admin` with role-aware UI (Membre / VIP / Admin / Invité).
  - Schema (Supabase): `user_profiles { id, email, role, is_vip, vip_granted_at, created_at }`, `user_favorites { id, user_id, channel_id }`, `vip_keys { id, key, used, used_by, used_at }`.
- **FavoritesProvider** (`/app/frontend/src/hooks/useFavorites.js`) — global React context now wraps the app in `App.js`. Heart toggle on any `ChannelCard` updates the header counter instantly (verified 0→1→2→3 in smoke screenshot).
- **Backend endpoints (Supabase-backed)**:
  - `POST /api/auth/redeem-vip` — JWT-protected, validates and atomically marks the key + bumps the user to VIP.
  - `POST /api/admin/vip-keys/generate` — admin-only batch key generation.
  - `POST /api/channels/by-ids` — enriched lookup for the Dashboard favorites grid.
- **VIP/Admin ad-bypass** wired into `AdUnlockModal` via `useAuth().hasAdFreeExperience`.
- **Bug fixes this session**:
  - Dashboard infinite spinner (RCA: AuthProvider had no timeout — fixed with Promise.race + safety setTimeout + maybeSingle).
  - React hydration warning `<button>` cannot be a descendant of `<button>` — `ChannelCard` outer element converted from `<button>` to `<div role="button" tabIndex={0} onKeyDown>`.
  - Admin.jsx hooks order violation (useMemo after early return) — hoisted memos above conditional returns.
  - Login.jsx now also shows an inline red error pill (in addition to the existing toast) so signUp/signIn 4xx errors are impossible to miss.
  - Truncated `SUPABASE_SERVICE_ROLE_KEY` replaced with full JWT in `/app/backend/.env`.

## Roadmap (post-2026-02-18)
- **P1** Surface clearer email-confirmation onboarding (currently a generic toast; show explicit "Vérifiez votre boîte mail" banner when Supabase has email confirmation enabled).
- **P1** Promote first registered user to admin automatically (or via env-listed admin emails) to bootstrap the Admin page.
- **P2** Move file structure: split `server.py` into `/app/backend/routes/{streams,supabase,admin}.py` and add `/app/backend/tests/` regression suite for the new Supabase endpoints.
- **P2** `/api/hls` upstream-degraded guard: return 502 when playlist body is missing `#EXTM3U` instead of a rewritten single-line proxy URL.

