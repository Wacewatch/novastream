import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { ArrowLeft, Search, Globe2, Loader2, Radio, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import AdUnlockModal from "@/components/AdUnlockModal";
import IframePlayer from "@/components/IframePlayer";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function DaddyTV() {
  const [data, setData] = useState({ channels: [], countries: [], categories: [] });
  const [loading, setLoading] = useState(true);
  const [country, setCountry] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(null);
  const [active, setActive] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = {};
        if (country) params.country = country;
        if (category) params.category = category;
        if (search.trim()) params.search = search.trim();
        const r = await axios.get(`${API}/daddy/channels`, { params });
        if (cancelled) return;
        setData(r.data);
      } catch (e) {
        console.error(e);
        if (!cancelled) toast.error("Erreur de chargement DaddyTV");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [country, category, search]);

  const grouped = useMemo(() => {
    const order = data.countries || [];
    const map = {};
    for (const c of data.channels) {
      if (!map[c.country]) map[c.country] = [];
      map[c.country].push(c);
    }
    const keys = order.filter((k) => map[k]);
    return { map, keys };
  }, [data]);

  const handleClick = (ch) => setPending(ch);

  const handleUnlocked = () => {
    if (!pending) return;
    setActive(pending);
    setPending(null);
  };

  return (
    <div className="relative min-h-screen text-white">
      <div className="ns-bg" />
      <div className="ns-grain" />

      <header className="sticky top-0 z-40 glass" style={{ borderRadius: 0, backdropFilter: "blur(22px) saturate(140%)" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3 sm:gap-6">
          <Link to="/" className="flex items-center gap-2 text-white/70 hover:text-white" data-testid="back-home">
            <ArrowLeft size={18} /> <span className="hidden sm:inline">Accueil</span>
          </Link>
          <div className="flex items-center gap-2.5">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center text-white"
              style={{ background: "linear-gradient(135deg,#ff8a00 0%,#ff5400 100%)" }}
            >
              <Radio size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <div className="font-extrabold tracking-tight text-xl">DaddyTV</div>
                <span className="badge-pub">PUB</span>
              </div>
              <div className="text-xs text-white/55 -mt-0.5">{data.channels.length} chaînes en direct</div>
            </div>
          </div>
          <div className="flex-1 hidden sm:flex justify-end gap-2">
            <span className="glass-pill" style={{ padding: "0.35rem 0.75rem" }}>
              <ShieldCheck size={14} className="text-emerald-400" /> Embed iframe
            </span>
          </div>
        </div>

        <div className="border-t border-white/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px] max-w-md">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                data-testid="daddy-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher une chaîne…"
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-[#ff2e63]/50"
              />
            </div>
            <div className="relative">
              <Globe2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
              <select
                data-testid="daddy-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm appearance-none cursor-pointer focus:outline-none focus:border-[#ff2e63]/50"
              >
                <option value="">Tous les pays</option>
                {(data.countries || []).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <select
              data-testid="daddy-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="pl-3 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm appearance-none cursor-pointer focus:outline-none focus:border-[#ff2e63]/50"
            >
              <option value="">Toutes les catégories</option>
              {(data.categories || []).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-20">
        {loading ? (
          <div className="flex items-center justify-center py-20" data-testid="daddy-loading">
            <Loader2 className="animate-spin text-[#ff8a00]" size={32} />
            <span className="ml-3 text-white/60">Chargement des chaînes DaddyTV…</span>
          </div>
        ) : data.channels.length === 0 ? (
          <div className="glass rounded-2xl p-10 text-center" data-testid="daddy-empty">
            <Radio size={36} className="mx-auto text-white/40 mb-2" />
            <div className="text-white/80 font-semibold">Aucune chaîne trouvée</div>
            <div className="text-white/50 text-sm mt-1">Modifiez les filtres ou la recherche.</div>
          </div>
        ) : country || search.trim() || category ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3" data-testid="daddy-grid">
            {data.channels.map((c) => (
              <DaddyCard key={c.id} ch={c} onClick={() => handleClick(c)} />
            ))}
          </div>
        ) : (
          <div className="space-y-8" data-testid="daddy-grouped">
            {grouped.keys.map((cn) => (
              <div key={cn}>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-white text-lg font-extrabold">{cn}</h2>
                  <span className="text-xs text-white/40">({grouped.map[cn].length})</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {grouped.map[cn].slice(0, 24).map((c) => (
                    <DaddyCard key={c.id} ch={c} onClick={() => handleClick(c)} />
                  ))}
                </div>
                {grouped.map[cn].length > 24 && (
                  <button
                    onClick={() => setCountry(cn)}
                    className="mt-3 text-sm text-[#ff8a00] hover:underline"
                  >
                    Voir les {grouped.map[cn].length} chaînes de {cn} →
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {pending && (
        <AdUnlockModal
          channel={pending}
          onUnlocked={handleUnlocked}
          onCancel={() => setPending(null)}
        />
      )}

      {active && (
        <IframePlayer
          src={active.embed_url}
          title={`${active.name} — DaddyTV`}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}

function DaddyCard({ ch, onClick }) {
  return (
    <button
      onClick={onClick}
      data-testid={`daddy-card-${ch.id}`}
      className="glass rounded-xl p-3 text-left hover:border-[#ff8a00]/40 hover:bg-[#ff8a00]/5 transition-all duration-200 border border-white/8 hover:-translate-y-0.5"
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0"
          style={{ background: "linear-gradient(135deg,#ff8a00 0%,#ff5400 100%)" }}
        >
          <Radio size={16} />
        </div>
        <span className="badge-pub">PUB</span>
      </div>
      <div className="text-sm font-semibold text-white truncate" title={ch.name}>{ch.name}</div>
      <div className="text-[11px] text-white/50 mt-0.5 truncate">
        {ch.category} · {ch.country}
      </div>
    </button>
  );
}
