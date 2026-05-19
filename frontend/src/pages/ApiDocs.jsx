import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const ENDPOINT = `${BACKEND_URL}/api/v1/public/all`;
const LOGO_URL = "https://i.imgur.com/V8YmT4z.png";

export default function ApiDocs() {
  const [count, setCount] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(ENDPOINT);
        setCount({
          channels: r.data.total,
          countries: r.data.countries.length,
        });
      } catch (_e) {
        /* ignore */
      }
    })();
  }, []);

  const copy = () => {
    navigator.clipboard.writeText(ENDPOINT).then(() => toast.success("URL copiée"));
  };

  return (
    <div className="relative min-h-screen text-white">
      <div className="ns-bg" />
      <div className="ns-grain" />

      {/* Header */}
      <header className="sticky top-0 z-40 glass" style={{ borderRadius: 0, backdropFilter: "blur(22px) saturate(140%)" }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2.5">
            <img src={LOGO_URL} alt="LiveWatch" className="h-7 sm:h-8 w-auto" />
          </Link>
          <Link to="/" className="ad-btn-secondary !py-2 !px-4 text-sm">
            ← Retour
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-14">
        <p className="text-white/50 uppercase tracking-[0.2em] text-xs mb-2">Documentation</p>
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight" style={{ fontFamily: "Outfit, sans-serif" }}>
          API <span className="text-[#ff2e63]">LiveWatch</span>
        </h1>

        <p className="text-white/70 mt-4 leading-relaxed">
          Une seule URL retourne, en JSON, la liste complète des <strong className="text-white">pays</strong>,
          des <strong className="text-white">catégories</strong> et de toutes les <strong className="text-white">chaînes</strong>
          {count && (
            <> (<span className="text-[#ff2e63] font-semibold">{count.channels}</span> chaînes
            réparties dans <span className="text-[#ff2e63] font-semibold">{count.countries}</span> pays)</>
          )}.
          Chaque chaîne contient son <strong className="text-white">URL embed</strong> à insérer directement
          dans un <code className="text-white/80">&lt;iframe&gt;</code>. Aucun flux brut n'est jamais exposé
          en dehors de cette page embed.
        </p>

        {/* The single endpoint */}
        <div className="glass rounded-2xl p-5 mt-8" data-testid="api-endpoint-block">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-[#ff2e63]/15 text-[#ff2e63] border border-[#ff2e63]/30">
              GET
            </span>
            <code className="text-sm sm:text-base text-white font-mono truncate flex-1" data-testid="api-endpoint-url">
              {ENDPOINT}
            </code>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={copy} className="ad-btn-secondary !py-2 !px-4 text-sm" data-testid="copy-api-url">
              <Copy size={14} className="inline-block mr-1.5" />
              Copier l'URL
            </button>
            <a
              href={ENDPOINT}
              target="_blank"
              rel="noreferrer"
              className="ad-btn-secondary !py-2 !px-4 text-sm"
              data-testid="open-api-url"
            >
              <ExternalLink size={14} className="inline-block mr-1.5" />
              Ouvrir le JSON
            </a>
          </div>
        </div>

        {/* Response shape */}
        <h2 className="text-lg font-bold mt-10 mb-3">Format de la réponse</h2>
        <pre className="glass rounded-xl p-4 text-xs sm:text-sm text-white/85 overflow-x-auto leading-relaxed">
{`{
  "total": 950,
  "countries":  ["Albania", "Belgium", "France", ...],
  "categories": ["Sport", "Info", "Cinéma", ...],
  "channels": [
    {
      "id":         "40704463696c79db63feff-e6a0ec9bd6708c",
      "name":       "13EME RUE .b",
      "country":    "France",
      "categories": ["Cinéma"],
      "embed_url":  "${BACKEND_URL}/embed/40704463696c79db63feff-e6a0ec9bd6708c"
    }
  ]
}`}
        </pre>

        {/* Iframe usage */}
        <h2 className="text-lg font-bold mt-10 mb-3">Intégration via iframe</h2>
        <p className="text-white/65 text-sm mb-3">
          Récupérez le champ <code className="text-white/85">embed_url</code> d'une chaîne et insérez-le dans un iframe :
        </p>
        <pre className="glass rounded-xl p-4 text-xs sm:text-sm text-white/85 overflow-x-auto">
{`<iframe
  src="${BACKEND_URL}/embed/{channel_id}"
  width="960" height="540"
  frameborder="0"
  allow="autoplay; fullscreen; picture-in-picture"
  allowfullscreen
></iframe>`}
        </pre>

        {/* ===== Other public APIs (DaddyTV / Sports / Football / Informations) ===== */}
        <div className="mt-14 pt-10 border-t border-white/10">
          <h2 className="text-2xl font-extrabold tracking-tight mb-2">
            Autres APIs publiques
          </h2>
          <p className="text-white/55 text-sm">
            Tous les endpoints retournent du JSON, sans authentification.
            Les liens de lecture sont des <strong className="text-white">URLs embed</strong> (à mettre dans un iframe)
            — aucun flux direct n'est exposé.
          </p>
        </div>

        {/* DaddyTV */}
        <ApiSection
          title="DaddyTV"
          accent="#ff8a00"
          intro="Liste des chaînes DaddyTV (≈ 800 chaînes). Chaque entrée contient le champ embed_url à insérer dans un iframe."
          endpoints={[
            { method: "GET", url: `${BACKEND_URL}/api/v1/public/daddy/channels`, desc: "Liste complète (params optionnels : search, country, category, limit)" },
            { method: "GET", url: `${BACKEND_URL}/api/v1/public/daddy/channel/{id}`, desc: "Détail d'une chaîne" },
            { method: "GET", url: `${BACKEND_URL}/api/v1/public/daddy/countries`, desc: "Liste des pays + nombre de chaînes" },
            { method: "GET", url: `${BACKEND_URL}/api/v1/public/daddy/categories`, desc: "Liste des catégories + comptage" },
          ]}
          sample={`{
  "total": 817,
  "channels": [
    {
      "id": "35",
      "name": "Eurosport 1 France",
      "country": "France",
      "category": "Sport",
      "embed_url": "https://daddylive.li/embed/stream.php?id=35&player=1&source=tv"
    }
  ]
}`}
        />

        {/* Sports (streamed.pk) */}
        <ApiSection
          title="Sports"
          accent="#10b981"
          intro="Matchs et événements en direct du jour (Hockey, Football, Cricket, Tennis, Basket…). Source : streamed.pk."
          endpoints={[
            { method: "GET", url: `${BACKEND_URL}/api/v1/public/sports`, desc: "Tous les matchs du jour (param optionnel : sport)" },
          ]}
          sample={`{
  "total": 165,
  "sports": ["football", "basketball", "tennis", ...],
  "liveCount": 12,
  "events": [
    {
      "id": "abc123",
      "title": "Italy Ice Hockey vs Norway Ice Hockey",
      "sport": "hockey",
      "time": "19/05 16:20",
      "popular": true,
      "isLive": false,
      "home": "Italy Ice Hockey",
      "away": "Norway Ice Hockey",
      "homeBadge": "https://streamed.pk/api/images/badge/xxx.webp",
      "sources": [
        { "source": "alpha", "id": "match-id", "name": "alpha", "embedUrl": "" }
      ]
    }
  ]
}`}
        />

        {/* Football Live (RapidAPI) */}
        <ApiSection
          title="Football Live"
          accent="#f97316"
          intro="Matchs de football avec serveurs de streaming (logos d'équipes, ligues, scores live). Embed URL inclus pour chaque serveur."
          endpoints={[
            { method: "GET", url: `${BACKEND_URL}/api/v1/public/football`, desc: "Tous les matchs (live + à venir)" },
          ]}
          sample={`{
  "total": 65,
  "live_count": 13,
  "league_count": 33,
  "leagues": ["Premier League", "Serie A", ...],
  "matches": [
    {
      "id": "ab12cd",
      "title": "PSG vs Real Madrid",
      "home": "PSG",
      "away": "Real Madrid",
      "home_logo": "https://...",
      "away_logo": "https://...",
      "home_score": 1,
      "away_score": 0,
      "league": "UEFA Champions League",
      "is_live": true,
      "timestamp": 1716148800,
      "time_label": "19 May 21:00",
      "has_servers": true,
      "server_count": 4
    }
  ]
}`}
          extra={`Pour récupérer les serveurs d'un match précis :
${BACKEND_URL}/api/v1/public/football  → puis utilisez "id"
${BACKEND_URL}/api/football/streams?mid={id}  → renvoie { servers:[{name,url}] }`}
        />

        {/* Informations (tv247.us) */}
        <ApiSection
          title="Informations (Planning)"
          accent="#3b82f6"
          intro="Programme du jour : événements (rugby, tennis, foot, …) avec les chaînes DaddyTV qui les diffusent. Source : tv247.us."
          endpoints={[
            { method: "GET", url: `${BACKEND_URL}/api/v1/public/sports/info`, desc: "Planning de la journée avec chaînes" },
          ]}
          sample={`{
  "total_days": 1,
  "days": [
    {
      "day": "Tuesday 19th May 2026",
      "events": [
        {
          "time": "15:00",
          "event": "French Open Tennis - Roland Garros",
          "channels": [
            { "channel_id": "772", "channel_name": "Eurosport 1 France" }
          ]
        }
      ]
    }
  ]
}`}
        />

        <p className="text-center text-white/40 text-xs mt-14 mb-4">
          © {new Date().getFullYear()} LiveWatch
        </p>
      </main>
    </div>
  );
}

function ApiSection({ title, accent, intro, endpoints, sample, extra }) {
  const copy = (url) => {
    navigator.clipboard.writeText(url).then(() => toast.success("URL copiée"));
  };
  return (
    <section className="mt-10" data-testid={`api-section-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <h3 className="text-xl font-extrabold flex items-center gap-2 mb-1">
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: accent }} />
        {title}
      </h3>
      <p className="text-white/60 text-sm mb-4">{intro}</p>

      <div className="space-y-2 mb-4">
        {endpoints.map((e) => (
          <div key={e.url} className="glass rounded-xl p-3 flex items-center gap-3 flex-wrap">
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#ff2e63]/15 text-[#ff2e63] border border-[#ff2e63]/30">
              {e.method}
            </span>
            <code className="text-xs sm:text-sm text-white font-mono flex-1 truncate min-w-0">{e.url}</code>
            <button
              onClick={() => copy(e.url)}
              className="text-xs text-white/60 hover:text-white inline-flex items-center gap-1"
              title="Copier"
            >
              <Copy size={12} /> Copier
            </button>
            <a
              href={e.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-white/60 hover:text-white inline-flex items-center gap-1"
            >
              <ExternalLink size={12} /> Ouvrir
            </a>
            <div className="basis-full text-xs text-white/45 -mt-1">{e.desc}</div>
          </div>
        ))}
      </div>

      <pre className="glass rounded-xl p-4 text-xs sm:text-sm text-white/85 overflow-x-auto leading-relaxed">
{sample}
      </pre>
      {extra && (
        <pre className="glass rounded-xl p-4 mt-3 text-xs sm:text-sm text-white/70 overflow-x-auto leading-relaxed">
{extra}
        </pre>
      )}
    </section>
  );
}
