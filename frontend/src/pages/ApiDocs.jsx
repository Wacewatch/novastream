import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { Copy, ExternalLink, Tv2 } from "lucide-react";
import { toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function Endpoint({ method, path, desc, sample }) {
  const fullUrl = `${BACKEND_URL}${path}`;
  const copy = () => {
    navigator.clipboard.writeText(fullUrl).then(() => toast.success("URL copiée"));
  };
  return (
    <div className="glass rounded-2xl p-5 mb-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-[#ff2e63]/15 text-[#ff2e63] border border-[#ff2e63]/30">
          {method}
        </span>
        <code className="text-sm text-white font-mono truncate flex-1">{path}</code>
        <button
          onClick={copy}
          className="ad-btn-secondary !py-1.5 !px-3 text-xs"
          title="Copier l'URL"
        >
          <Copy size={14} className="inline-block mr-1" />
          Copier
        </button>
        <a
          href={fullUrl}
          target="_blank"
          rel="noreferrer"
          className="ad-btn-secondary !py-1.5 !px-3 text-xs"
          title="Tester dans un nouvel onglet"
        >
          <ExternalLink size={14} className="inline-block mr-1" />
          Ouvrir
        </a>
      </div>
      <p className="text-white/70 text-sm mt-3">{desc}</p>
      {sample && (
        <pre className="mt-3 p-3 rounded-lg bg-black/50 border border-white/5 text-xs text-white/80 overflow-x-auto">
          {sample}
        </pre>
      )}
    </div>
  );
}

export default function ApiDocs() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [c, co, cat] = await Promise.all([
          axios.get(`${API}/v1/public/channels?limit=5000`),
          axios.get(`${API}/v1/public/countries`),
          axios.get(`${API}/v1/public/categories`),
        ]);
        setStats({
          channels: c.data.total,
          countries: co.data.total,
          categories: cat.data.categories.length,
        });
      } catch (e) {
        // ignore
      }
    })();
  }, []);

  return (
    <div className="relative min-h-screen text-white">
      <div className="ns-bg" />
      <div className="ns-grain" />

      {/* Header */}
      <header className="sticky top-0 z-40 glass" style={{ borderRadius: 0, backdropFilter: "blur(22px) saturate(140%)" }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="https://i.imgur.com/HrbEzpm.png" alt="LiveWatch" className="h-7 sm:h-8 w-auto" />
          </Link>
          <Link to="/" className="ad-btn-secondary !py-2 !px-4 text-sm">
            ← Retour au site
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-8">
          <p className="text-white/50 uppercase tracking-[0.2em] text-xs mb-2">Documentation • v1</p>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight" style={{ fontFamily: "Outfit, sans-serif" }}>
            API <span className="text-[#ff2e63]">LiveWatch</span>
          </h1>
          <p className="text-white/60 mt-3 max-w-2xl">
            Récupérez la liste complète des chaînes, des pays et obtenez une URL embed pour
            intégrer le lecteur dans n'importe quel site via iframe.
          </p>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-3 gap-3 mb-10">
            <div className="glass-pill rounded-2xl p-5 text-center">
              <Tv2 className="mx-auto text-[#ff2e63] mb-2" size={22} />
              <div className="text-2xl font-bold">{stats.channels}</div>
              <div className="text-white/50 text-xs uppercase tracking-wider">chaînes</div>
            </div>
            <div className="glass-pill rounded-2xl p-5 text-center">
              <div className="text-2xl font-bold mt-7">{stats.countries}</div>
              <div className="text-white/50 text-xs uppercase tracking-wider">pays</div>
            </div>
            <div className="glass-pill rounded-2xl p-5 text-center">
              <div className="text-2xl font-bold mt-7">{stats.categories}</div>
              <div className="text-white/50 text-xs uppercase tracking-wider">catégories</div>
            </div>
          </div>
        )}

        {/* Base URL */}
        <section className="mb-8">
          <h2 className="text-xl font-bold mb-3">Base URL</h2>
          <div className="glass rounded-xl p-4 flex items-center gap-3">
            <code className="text-sm text-white font-mono flex-1 truncate">{BACKEND_URL}</code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(BACKEND_URL);
                toast.success("Base URL copiée");
              }}
              className="ad-btn-secondary !py-1.5 !px-3 text-xs"
            >
              <Copy size={14} className="inline-block mr-1" />
              Copier
            </button>
          </div>
          <p className="text-white/50 text-sm mt-2">
            Toutes les routes sont publiques, retournent du JSON et n'exigent aucune authentification.
            CORS est ouvert (<code className="text-white/70">*</code>).
          </p>
        </section>

        {/* Endpoints */}
        <section>
          <h2 className="text-xl font-bold mb-4">Endpoints</h2>

          <Endpoint
            method="GET"
            path="/api/v1/public/countries"
            desc="Liste de tous les pays disponibles."
            sample={`{
  "total": 21,
  "countries": ["Albania", "Belgium", "France", ...]
}`}
          />

          <Endpoint
            method="GET"
            path="/api/v1/public/categories"
            desc="Liste des catégories de chaînes (Sport, Info, Cinéma…)."
            sample={`{ "categories": ["Sport", "Info", "Cinéma", ...] }`}
          />

          <Endpoint
            method="GET"
            path="/api/v1/public/channels?country=France&category=Sport&search=tf1&limit=2000"
            desc="Liste toutes les chaînes. Paramètres optionnels : country, category, search, limit (1-5000)."
            sample={`{
  "total": 800,
  "channels": [
    {
      "id": "40704463696c79db63feff",
      "name": "13EME RUE .b",
      "country": "France",
      "categories": ["Cinéma"],
      "stream_url": "${BACKEND_URL}/api/stream/40704463696c79db63feff",
      "embed_url":  "${BACKEND_URL}/embed/40704463696c79db63feff"
    }
  ]
}`}
          />

          <Endpoint
            method="GET"
            path="/api/v1/public/channel/{id}"
            desc="Détails d'une chaîne précise."
            sample={`{
  "id": "40704463696c79db63feff",
  "name": "13EME RUE .b",
  "country": "France",
  "categories": ["Cinéma"],
  "stream_url": "...",
  "embed_url":  "..."
}`}
          />

          <Endpoint
            method="GET"
            path="/api/stream/{id}"
            desc="Résout l'URL HLS proxifiée d'une chaîne (utilisée par le lecteur)."
            sample={`{
  "id": "40704463696c79db63feff",
  "name": "13EME RUE .b",
  "proxy_url": "/api/hls?u=..."
}`}
          />
        </section>

        {/* Embed */}
        <section className="mt-10">
          <h2 className="text-xl font-bold mb-3">Intégration via iframe</h2>
          <p className="text-white/60 text-sm mb-4">
            Récupérez le champ <code className="text-white/80">embed_url</code> de chaque chaîne
            et insérez-le dans un iframe. Le lecteur, la modale et la lecture sont autonomes.
          </p>
          <pre className="glass rounded-xl p-4 text-sm text-white/85 overflow-x-auto">
{`<iframe
  src="${BACKEND_URL}/embed/{channel_id}"
  width="960"
  height="540"
  frameborder="0"
  allow="autoplay; fullscreen; picture-in-picture"
  allowfullscreen
></iframe>`}
          </pre>
        </section>

        <p className="text-center text-white/40 text-xs mt-12 mb-4">
          © {new Date().getFullYear()} LiveWatch — API publique v1
        </p>
      </main>
    </div>
  );
}
