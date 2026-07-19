# LiveWatch - PRD

## Original Request
Faire fonctionner la preview du projet livewatch avec les credentials Supabase fournis.

## Architecture (déployée dans cet environnement Next.js)
- **Frontend**: Next.js 15 (App Router `[[...slug]]` + SPA react-router-dom) à `/app`, port 3000
- **Backend**: FastAPI (Python) à `/app/backend`, port 8001 (routes préfixées `/api`)
- **Proxy**: Next.js `rewrites()` redirige `/api/*` → `http://localhost:8001/api/*`
  (car l'ingress route `/api` → port 3000)
- **DB**: MongoDB local (DB_NAME=livewatch) + Supabase (auth + user_profiles + vip_keys)
- **Stream Source**: proxy HLS upstream (vavoo.to / kool.to)

## Setup réalisé (2026-07-19)
- Migration: frontend → `/app`, backend FastAPI → `/app/backend`
- `.env` (Next.js) et `backend/.env` configurés avec credentials Supabase fournis
- Dépendances Python installées dans `/root/.venv`, deps frontend via yarn
- Superviseur: ajout de `/etc/supervisor/conf.d/backend.conf` (uvicorn 8001)
- **Fix clé**: `NODE_OPTIONS max-old-space-size` porté de 512 → 2048 MB
  (la limite 512 provoquait des redémarrages mémoire → pages blanches intermittentes)
- `allowedDevOrigins` ajouté dans next.config.js

## Vérifié fonctionnel
- Frontend rend l'UI complète (onglets LiveTV/FrameTV/NorthTV/DaddyTV/Sports, 971 chaînes FR)
- `/api/channels`, `/api/countries`, `/api/stats` → 200
- `/api/stream/{id}` résout et renvoie un `proxy_url` HLS (streaming OK end-to-end)
- 9500+ chaînes chargées via upstream

## Next Actions (à valider avec l'utilisateur)
- Tester login Supabase / profil utilisateur / rôles (member/vip/admin)
- Tester lecture vidéo d'une chaîne dans le lecteur
- Vérifier le panneau admin et les clés VIP
