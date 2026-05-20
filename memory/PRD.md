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
### 2026-05-20 (current session #2 — UX polish + public API leak-proofing)
- **DaddyTV iframe inside player overlay** (not full-page): `IframePlayer.jsx` rewritten to use `.player-shell > .player-frame` (16/9 centered, rounded, max 1280px), matching the HLS VideoPlayer layout. Top bar (logo/title/reload/external/fullscreen/close) floats over the iframe via absolute positioning.
- **Public API leak-proofing**:
  - `/v1/public/daddy/channels` + `/v1/public/daddy/channel/{id}` — `embed_url` now points to OUR `/embed/daddy/{id}` (was upstream `player.cfbu247.sbs/embed/...`).
  - `/v1/public/sports` — each event has `embeds: [{label, embed_url}]` with `embed_url` = `/embed/sports/t/{base64url(source:id)}`. Strips upstream `source` and `embedUrl` from JSON.
  - `/v1/public/football` — each match has `embeds: [{label, embed_url}]` with `embed_url` = `/embed/football/t/{base64url(matchId:idx)}`. Drops `has_servers`/`server_count`. The internal `stream_url` / raw m3u8 are never exposed publicly.
  - `/v1/public/sports/info` — pass-through (only DaddyTV channel refs, no upstream URLs).
- **Token-redirect React pages**: `SportsTokenRedirect.jsx`, `FootballTokenRedirect.jsx` (client-side base64url decode → `Navigate` to the real embed). New `FootballEmbedPage.jsx` (mounts at `/embed/football/:matchId/:serverIdx?`) — fetches `/api/football/streams`, gates behind `AdUnlockModal`, plays via VideoPlayer.
- **Favorites star on DaddyTV cards**: `DaddyCard` now renders `<FavoriteButton channelId={`daddy:${ch.id}`}/>` (top-right). Outer wrapper changed from `<button>` to `<div role="button" tabIndex={0}>` to avoid nested-button HTML hydration warning. Persists in localStorage `livewatch.favorites.v1` (shared with TV).
- **Slug-seed rotation**: `_build_slug_map` now iterates over `('abc-usa','bbc-one-uk','astro-supersport-1','cnn-usa','espn-usa')` — first working seed wins. Hardens the slug→numeric channel_id resolver against any single seed being removed upstream.
- Backend: 21/21 pytest pass (8 new contract tests + 13 regression). Frontend: Playwright validated all flows.


- **DaddyTV slug→numericID resolver** (`extensions.py` _build_slug_map / _resolve_slug_to_numeric, 6h cache). Fetches `player.cfbu247.sbs/embed/abc-usa`, discovers `channelData-XXX.js`, parses ~830 slug↔channel_id pairs. Slug-XXX channels (Automoto, 18+, etc.) NOW return both `stream_url` (m3u8 via DLStream) AND `iframe_url` (chat.cfbu247.sbs/api/proxy/player — frame-friendly). Previously they were stuck on `player.cfbu247.sbs/embed/…` which is CSP-blocked.
- **MongoDB persistent cache for TV channels**: `db.cached_catalog._id='channels'` populated on every successful refresh. Cold-start `/api/channels` calls now serve from DB while a background refresh kicks off → response < 1 s (was 30–40 s). In-memory TTL bumped to 15 min.
- **Periodic background refresh** every 15 min via `asyncio.create_task(_periodic_refresh())` in `on_event('startup')`. Failures non-fatal; DB cache keeps users served.
- **18+ age gate** in `AdUnlockModal.jsx`: new `adult` prop, when true displays a red-themed modal `[data-testid="ad-modal-age-gate"]` BEFORE the regular ad flow (and even before VIP/admin bypass). Requires user to click "Je confirme avoir 18 ans ou plus". `DaddyEmbedPage` + `NovaStream` pass `adult={category.includes('18')}`.
- **HLS → iframe watchdog** reduced from 30 s → 8 s for DaddyTV (`DaddyEmbedPage.jsx` + `NovaStream.jsx`) so users don't stare at a 30 s blank when upstream returns 502.
- 13/13 pytest cases pass; Playwright validated age gate + cache speed.

### Earlier
- Real channel **logos** via `github.com/tv-logo/tv-logos` (~200 FR + many other countries). Index built at startup; per-channel lookup is in-memory O(1); fallback to TV icon when no slug match.
- **Quality tag** (HD/FHD/4K/UHD) detected from channel name, color-coded (blue / violet / gold).
- **View tracking** in MongoDB (`views` collection, TTL 24 h, idx on `ts` and `(channel_id, ts)`). Aggregated to a memo-cached stats object (`live_total`, `total_24h`, `per_channel`).
- `/api/stats` endpoint; FE polls every 20 s. Header pill `X VUES / 24 H`. Hero pulse-dot pill. Per-card viewers badge.
- Player kebab menu cleaned, retry feedback, grid fluidity (memo + content-visibility).
- Stable per-channel IDs (md5 of upstream URL). HLS playlist micro-cache (2 s) + per-channel resolve lock.
- Embed page + public `/api/v1/public/*` namespace. Ad-unlock flow before play.
- FlagCDN integration: `@/lib/flags` + `FlagIcon` component used in NovaStream, MultiView, DaddyTab.

## Backlog / Roadmap
- **P1**: Split `extensions.py` (~1800 LoC) into `daddy_router.py`, `sports_router.py`, `football_router.py`, `admin_router.py`.
- **P2**: Slug map seed rotation (currently single `abc-usa` — add 3–5 fallback slugs in case upstream removes it).
- **P2**: Adult-age confirmation persistence (localStorage, e.g. 24 h) to avoid re-asking on every reload.
- **P2**: Measure 8 s watchdog on 3G — may need to push to 12 s on slow networks.
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


## Session 2026-02-18 (part 2) — Admin Stats Modules
- **Removed 500-user limit** in `/admin` — pagination with Supabase `.range()` in 1000-row chunks (50k hard safety cap).
- **4 new admin endpoints** (all `_require_admin` JWT-protected):
  - `GET /api/admin/system-stats` — CPU %, RAM %, process MB, uptime, platform, python version (via `psutil`).
  - `GET /api/admin/live-stats` — `online`, `watching`, `total_24h`, `top_channels` (top 10 from `views` aggregation enriched with channel names).
  - `GET /api/admin/top-referrers` — top HTTP Referer hosts in last 24 h (default window).
  - `GET /api/admin/global-stats` — `total_users` / `admins` / `vips` / `total_channels` with `asyncio.gather` parallelization.
- **Referrer logging middleware** (`_log_referrer`) writes to `db.referrers` (TTL 30 d, indexed on `host,ts`). Only logs `/api/hls` and `/api/stream` Referer headers and skips self-referrals.
- **Admin.jsx rewritten** with new cards/sections:
  - 5 global stat cards (Utilisateurs / Admins / VIP / Chaînes / Clés VIP).
  - System cards: CPU App / RAM App / Réseau (live count) / Système (uptime, platform, python).
  - "Statistiques en direct" block: En ligne, En visionnage, Top Chaînes en Direct.
  - "Top Référents" with progress-bar style ranking.
  - Existing VIP keys & Users tables preserved.
  - Polls backend admin endpoints every 5 s.
- **Dashboard avatar** placeholder initials replaced with site logo `<img src="https://i.imgur.com/V8YmT4z.png">`.
- **Tests**: `testing_agent_v3_fork` iter_4 → backend 15/15 pytest, frontend 100% (admin gating, multiview, favorites sync all green).


## Session 2026-02-18 (part 3) — Bugfixes signalés par l'utilisateur
- **Bug Top Référents inflaté** : le middleware `_log_referrer` loggait chaque segment `.ts` (≈1/s par viewer) → le compteur explosait sans nouvelle lecture. Corrigé : on n'enregistre désormais QUE sur `/api/stream/{id}` (action "play" unique par lecture). 153 enregistrements bidons supprimés de la collection `db.referrers`.
- **Comptage VIP faux** : `/api/admin/global-stats` ne comptait que `is_vip=true`, manquant les comptes `role=vip` sans flag `is_vip`. Corrigé via filtre Supabase `or=(role.eq.vip,is_vip.eq.true)`.
- **Modal pub apparaissait pour Admin/VIP** : si le profil Supabase n'était pas encore résolu (RLS, latence) au moment où l'utilisateur cliquait sur une chaîne, `hasAdFreeExperience` était `false` et la modal pub s'affichait. Corrigé dans `AdUnlockModal.jsx` :
  - Affiche un **loader neutre** tant que `loading=true` ou `(user && !profile)`.
  - Déclenche un `refreshProfile()` automatique si la session est là mais le profil est vide.
  - Cap de 4 s sur le loader pour éviter un blocage définitif.


## Session 2026-02-18 (part 4) — Nettoyage des erreurs réseau
- **Erreurs DevTools `e/?ip=0&_=...&ver=1.374.2`** identifiées comme des appels PostHog (session_recording, autocapture) bloqués par l'ad-blocker de l'utilisateur. PostHog ré-essaye 3× chaque appel d'où l'inflation des entrées `retry_count=N`.
- **Fix dans `/app/frontend/public/index.html`** : la config PostHog désactive désormais `session_recording` (la source principale du bruit), `autocapture`, `capture_pageleave`, `advanced_disable_decide` et `advanced_disable_feature_flags`. Le pageview basique est conservé.
- Vérification : 0 requête bloquée détectée par Playwright après le fix.



## Session 2026-02-19 — DaddyTV + Sports + Football: SPA tab refactor

### Major refactor
- **`NovaStream.jsx` is now a single-page tab container** for TV / DaddyTV / Sports.
  - `activeTab` state (`tv` | `daddy` | `sports`) + `sportsSubTab` (`sports` | `football` | `info`) — clicking the 3 hub cards switches content WITHOUT React Router navigation. Header & hub buttons stay visible.
  - Single `pending` state drives a single `AdUnlockModal` for all 5 playback kinds (`tv`, `daddy`, `info`, `sports`, `football`). Server/source switching mutates the per-overlay state only → ad cannot replay.
- **New tab components** under `/app/frontend/src/components/tabs/`:
  - `DaddyTab.jsx` — filterable channel grid (search/country/category), groups by country with "Voir les N chaînes" expansion.
  - `SportsTab.jsx` — streamed.pk matches (Populaires + Live + Tous).
  - `FootballTab.jsx` — RapidAPI matches (LIVE + Upcoming, league filter).
  - `InfoTab.jsx` — tv247 planning. Clicking a channel resolves it against the DaddyTV catalog (by id → by normalized name → fuzzy startsWith → /api/daddy/channel/{id}) then triggers the standard ad-modal → iframe-player flow.
- **`VideoPlayer.jsx`** now accepts optional `servers`/`activeServerId`/`onSwitchServer` props. When present, a "Serveur" entry appears in the kebab menu — used by the Football overlay so users can flip servers in-place.
- **Deleted** `/app/frontend/src/pages/DaddyTV.jsx` and `/app/frontend/src/pages/Sports.jsx`. Legacy routes `/daddy` and `/sports` now `<Navigate to="/" replace />`.

### UI cleanup (per user feedback)
- TV button label: "TV — Chaînes en direct" (removed "vavoo").
- DaddyTV button: no more "PUB" badge. Subtitle: "Chaînes mondiales en direct" (no 800-channel cap text).
- Sports button: no more "PUB" badge.
- Removed the "Direct • 🇫🇷 France / Toutes vos chaînes en direct…" intro paragraph entirely.
- Country dropdown + category pills moved into their own row BELOW the hub buttons (`[data-testid="tv-controls"]`); visible only when TV tab is active.

### Backend
- DaddyTV catalog now dynamically merges:
  1. external channels JSON (default: `daddylive.li/player/player10.json`)
  2. external m3u8 JSON (default: `player.cfbu247.sbs/allchannel.json`)
  3. static fallback from `daddy_channels.py`
  Catalog cached in-memory 5 min. `/api/daddy/stream/{id}` returns a `/api/football/proxy?url=…` URL for the matched m3u8.
- Admin endpoints: `GET/PATCH /api/admin/daddy/config` (enabled, channels_url, m3u8_url) and `POST /api/admin/daddy/test` (dry-run with stats: total/matched/sample).
- Admin UI: new "Configuration DaddyTV" section in `/admin` with channels_url + m3u8_url inputs, toggle, Test/Save/Restore-defaults buttons, and live test result panel.

### Tests
- `testing_agent_v3_fork` iter_5 → backend 13/13 pytest (`/app/backend/tests/test_daddy_sports_football.py`), frontend 14/14 SPA assertions. AdUnlockModal opens correctly on football click. No regressions, no console errors.
- Known external: cfbu247.sbs upstream currently returns 502 → frontend defaults to the iframe `embed_url` path for DaddyTV/Info, which keeps playback reliable.

### Backlog (post-2026-02-19)
- **P1** Split `extensions.py` (1371 LOC) into `routes/{daddy,sports,football,admin_daddy,admin_football}.py`. Same for `server.py`.
- **P2** Length-difference threshold on InfoTab fuzzy name match to avoid short-prefix collisions (e.g. "tf1" vs "tf1 series films").
- **P2** LRU cap on `_fb_servers_by_mid` index to bound memory if upstream returns nullish ids.
- **P2** Surface clearer fallback message in the player when the DaddyTV HLS proxy returns 502 (auto-switch to iframe in-place).
