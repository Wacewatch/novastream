import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { Copy, ExternalLink, Code2 } from "lucide-react";
import { toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || window.location.origin;
const LOGO_URL = "https://i.imgur.com/V8YmT4z.png";

// Five "all-in-one" endpoints. Each returns a single JSON blob with everything
// a third-party integrator needs (lists + embed URLs). NO upstream source name
// and NO direct stream URL is ever exposed.
const SECTIONS = [
  {
    key: "tv",
    accent: "#ff2e63",
    title: "Chaînes TV",
    intro:
      "Catalogue complet des chaînes TV en direct (≈ 950 chaînes, 17 pays). Chaque entrée contient son embed_url à insérer directement dans un iframe — aucun flux n'est exposé.",
    url: `${BACKEND_URL}/api/v1/public/all`,
    sample: `{
  "total": 950,
  "countries":  ["Albania", "Belgium", "France", "..."],
  "categories": ["Sport", "Info", "Cinéma", "..."],
  "channels": [
    {
      "id":         "40704463696c79db63feff-e6a0ec9bd6708c",
      "name":       "TF1",
      "country":    "France",
      "categories": ["Généraliste"],
      "embed_url":  "${BACKEND_URL}/embed/40704463696c79db63feff-e6a0ec9bd6708c"
    }
  ]
}`,
  },
  {
    key: "daddy",
    accent: "#ff8a00",
    title: "DaddyTV",
    intro:
      "Catalogue DaddyTV (≈ 817 chaînes, 35 pays). Comme pour les chaînes TV, chaque entrée renvoie un embed_url passant par notre domaine (modal + lecteur intégrés).",
    url: `${BACKEND_URL}/api/v1/public/daddy/channels`,
    sample: `{
  "total": 817,
  "countries":  ["Argentina", "Australia", "Brazil", "..."],
  "categories": ["Sport", "Movies", "News", "..."],
  "channels": [
    {
      "id":         "35",
      "name":       "Eurosport 1 France",
      "country":    "France",
      "category":   "Sport",
      "embed_url":  "${BACKEND_URL}/embed/daddy/35"
    }
  ]
}`,
  },
  {
    key: "sports",
    accent: "#10b981",
    title: "Sports",
    intro:
      "Matchs et événements en direct du jour (Hockey, Football, Cricket, Tennis, Basket…). Chaque match propose une liste embeds[] — chaque entrée est un embed_url opaque routé par notre domaine (le nom de la source n'est jamais exposé).",
    url: `${BACKEND_URL}/api/v1/public/sports`,
    sample: `{
  "total": 162,
  "sports": ["football", "basketball", "tennis", "..."],
  "sport_counts": { "football": 78, "tennis": 12, "..." : 0 },
  "live_count": 0,
  "popular_count": 121,
  "events": [
    {
      "id":         "italy-vs-norway-2387603",
      "title":      "Italy vs Norway",
      "sport":      "hockey",
      "league":     "",
      "time":       "19/05 16:20",
      "is_live":    false,
      "popular":    true,
      "home":       "Italy",
      "away":       "Norway",
      "home_badge": "https://…/badge/xxx.webp",
      "away_badge": "https://…/badge/yyy.webp",
      "embeds": [
        { "label": "Stream 1", "embed_url": "${BACKEND_URL}/embed/sports/t/…" },
        { "label": "Stream 2", "embed_url": "${BACKEND_URL}/embed/sports/t/…" }
      ]
    }
  ]
}`,
  },
  {
    key: "football",
    accent: "#f97316",
    title: "Football Live",
    intro:
      "Matchs de football avec serveurs de streaming (logos d'équipes, ligues, scores live). Chaque match propose une liste embeds[] dont les embed_url passent par notre domaine.",
    url: `${BACKEND_URL}/api/v1/public/football`,
    sample: `{
  "total": 74,
  "live_count": 13,
  "league_count": 33,
  "leagues": ["Premier League", "Serie A", "..."],
  "matches": [
    {
      "id":         "ab12cd-26",
      "title":      "PSG vs Real Madrid",
      "home":       "PSG",
      "away":       "Real Madrid",
      "home_logo":  "https://…/psg.png",
      "away_logo":  "https://…/real.png",
      "home_score": "1",
      "away_score": "0",
      "league":     "UEFA Champions League",
      "league_logo":"https://…/ucl.png",
      "status":     "live",
      "is_live":    true,
      "timestamp":  1716148800,
      "time_label": "19 May 21:00",
      "embeds": [
        { "label": "Stream 1", "embed_url": "${BACKEND_URL}/embed/football/t/…" },
        { "label": "Stream 2", "embed_url": "${BACKEND_URL}/embed/football/t/…" }
      ]
    }
  ]
}`,
  },
  {
    key: "bosstv",
    accent: "#d946ef",
    title: "BossTV",
    intro:
      "Matchs de football BossTV (HLS multi-serveurs). Mêmes garanties que Football Live : chaque match propose des embeds[] opaques routés par notre domaine, aucun flux ni nom de serveur upstream n'est exposé.",
    url: `${BACKEND_URL}/api/v1/public/bosstv`,
    sample: `{
  "total": 94,
  "live_count": 15,
  "upcoming_count": 73,
  "finished_count": 6,
  "league_count": 31,
  "leagues": ["NBA", "Premier League", "Serie A", "..."],
  "matches": [
    {
      "id":         "psg-vs-real-madrid-1779556000",
      "title":      "PSG vs Real Madrid",
      "home":       "PSG",
      "away":       "Real Madrid",
      "home_logo":  "https://…/psg.png",
      "away_logo":  "https://…/real.png",
      "league":     "UEFA Champions League",
      "status":     "live",
      "is_live":    true,
      "is_finished":false,
      "timestamp":  1779556000,
      "time_label": "23 May 21:00",
      "embeds": [
        { "label": "Stream 1", "embed_url": "${BACKEND_URL}/embed/bosstv/t/…" },
        { "label": "Stream 2", "embed_url": "${BACKEND_URL}/embed/bosstv/t/…" }
      ]
    }
  ]
}`,
  },
  {
    key: "info",
    accent: "#3b82f6",
    title: "Informations (Planning)",
    intro:
      "Programme TV du jour : événements (rugby, tennis, foot, …) avec les chaînes DaddyTV qui les diffusent. Chaque channel_id pointe vers une chaîne du catalogue DaddyTV (utilisez son embed_url pour la lecture).",
    url: `${BACKEND_URL}/api/v1/public/sports/info`,
    sample: `{
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
}`,
  },
];

export default function ApiDocs() {
  const [tvCount, setTvCount] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${BACKEND_URL}/api/v1/public/all`);
        setTvCount({
          channels: r.data.total,
          countries: r.data.countries.length,
        });
      } catch (_e) {
        /* ignore */
      }
    })();
  }, []);

  return (
    <div className="relative min-h-screen text-white">
      <div className="ns-bg" />
      <div className="ns-grain" />

      {/* Header */}
      <header
        className="sticky top-0 z-40 glass"
        style={{ borderRadius: 0, backdropFilter: "blur(22px) saturate(140%)" }}
      >
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
        <p className="text-white/50 uppercase tracking-[0.2em] text-xs mb-2">
          Documentation
        </p>
        <h1
          className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight"
          style={{ fontFamily: "Outfit, sans-serif" }}
        >
          API <span className="text-[#ff2e63]">LiveWatch</span>
        </h1>

        <p className="text-white/70 mt-4 leading-relaxed">
          Une <strong className="text-white">URL par catégorie</strong> renvoie,
          en JSON, l'intégralité du catalogue + les liens d'<strong className="text-white">embed</strong> à
          intégrer directement dans un <code className="text-white/80">&lt;iframe&gt;</code>.
          {tvCount && (
            <>
              {" "}Côté TV :{" "}
              <span className="text-[#ff2e63] font-semibold">{tvCount.channels}</span> chaînes
              dans <span className="text-[#ff2e63] font-semibold">{tvCount.countries}</span> pays.
            </>
          )}{" "}
          Aucun nom de source upstream n'est jamais exposé. Aucun flux direct (m3u8) n'est jamais
          exposé hors de l'embed.
        </p>

        <div className="glass rounded-2xl p-4 mt-6 flex items-start gap-3">
          <Code2 size={18} className="text-[#ff2e63] mt-0.5 shrink-0" />
          <p className="text-white/65 text-sm leading-relaxed">
            <strong className="text-white">Authentification :</strong> aucune. Tous les endpoints
            ci-dessous sont publics (CORS ouvert) et renvoient du JSON.
          </p>
        </div>

        {SECTIONS.map((s) => (
          <ApiSection key={s.key} section={s} />
        ))}

        <h2 className="text-lg font-bold mt-12 mb-3">Intégration via iframe</h2>
        <p className="text-white/65 text-sm mb-3">
          Récupérez le champ <code className="text-white/85">embed_url</code> de n'importe quelle
          entrée et insérez-le tel quel dans un iframe :
        </p>
        <pre className="glass rounded-xl p-4 text-xs sm:text-sm text-white/85 overflow-x-auto">
{`<iframe
  src="${BACKEND_URL}/embed/{id}"
  width="960" height="540"
  frameborder="0"
  allow="autoplay; fullscreen; picture-in-picture"
  allowfullscreen
></iframe>`}
        </pre>
        <p className="text-white/45 text-xs mt-3">
          Remplacez le chemin <code className="text-white/65">/embed/{"{id}"}</code> par
          {" "}<code className="text-white/65">/embed/daddy/{"{id}"}</code>,
          {" "}<code className="text-white/65">/embed/sports/t/{"{token}"}</code> ou
          {" "}<code className="text-white/65">/embed/football/t/{"{token}"}</code> selon la
          catégorie. Le format exact est fourni dans le champ <code>embed_url</code> de chaque
          réponse JSON ci-dessus.
        </p>

        <p className="text-center text-white/40 text-xs mt-14 mb-4">
          © {new Date().getFullYear()} LiveWatch
        </p>
      </main>
    </div>
  );
}

function ApiSection({ section }) {
  const { key, title, accent, intro, url, sample } = section;
  const copy = () => {
    navigator.clipboard.writeText(url).then(() => toast.success("URL copiée"));
  };
  return (
    <section className="mt-10" data-testid={`api-section-${key}`}>
      <h3 className="text-xl font-extrabold flex items-center gap-2 mb-1">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full"
          style={{ background: accent }}
        />
        {title}
      </h3>
      <p className="text-white/60 text-sm mb-4">{intro}</p>

      <div className="glass rounded-2xl p-4 mb-3" data-testid={`api-endpoint-${key}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="px-2 py-0.5 rounded-md text-[10px] font-bold border"
            style={{
              color: accent,
              background: `${accent}22`,
              borderColor: `${accent}55`,
            }}
          >
            GET
          </span>
          <code className="text-xs sm:text-sm text-white font-mono flex-1 truncate min-w-0">
            {url}
          </code>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={copy}
            className="ad-btn-secondary !py-1.5 !px-3 text-xs"
            data-testid={`api-copy-${key}`}
          >
            <Copy size={12} className="inline-block mr-1.5" />
            Copier l'URL
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="ad-btn-secondary !py-1.5 !px-3 text-xs"
            data-testid={`api-open-${key}`}
          >
            <ExternalLink size={12} className="inline-block mr-1.5" />
            Ouvrir le JSON
          </a>
        </div>
      </div>

      <pre className="glass rounded-xl p-4 text-xs sm:text-sm text-white/85 overflow-x-auto leading-relaxed">
{sample}
      </pre>
    </section>
  );
}
