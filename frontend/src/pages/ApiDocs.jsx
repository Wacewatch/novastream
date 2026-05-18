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

        <p className="text-center text-white/40 text-xs mt-14 mb-4">
          © {new Date().getFullYear()} LiveWatch
        </p>
      </main>
    </div>
  );
}
