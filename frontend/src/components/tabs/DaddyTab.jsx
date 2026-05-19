import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Search, Globe2, Loader2, Radio } from "lucide-react";
import { toast } from "sonner";
import FlagIcon from "@/components/FlagIcon";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * DaddyTV tab content (no own header — designed to render inside NovaStream tabs).
 * Calls onPick(channel) — the parent shows the AdUnlockModal then opens the IframePlayer.
 *
 * Optional props:
 *  - initialChannelId: when provided, auto-resolves the channel and triggers onPick.
 *  - onAfterAutoOpen: () => void  invoked after auto-open is fired (so parent can clear).
 */
export default function DaddyTab({ onPick, initialChannelId, onAfterAutoOpen }) {
  const [data, setData] = useState({ channels: [], countries: [], categories: [] });
  const [loading, setLoading] = useState(true);
  const [country, setCountry] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");

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
    return () => { cancelled = true; };
  }, [country, category, search]);

  // Auto-open from initialChannelId (used by the Info tab name-matching)
  useEffect(() => {
    if (!initialChannelId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API}/daddy/channel/${encodeURIComponent(initialChannelId)}`);
        if (cancelled) return;
        onPick?.(r.data);
      } catch (e) {
        console.error(e);
        toast.error("Chaîne DaddyTV introuvable");
      } finally {
        onAfterAutoOpen?.();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialChannelId]);

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

  return (
    <div className="space-y-4" data-testid="daddy-tab">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            data-testid="daddy-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une chaîne…"
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-[#ff8a00]/50"
          />
        </div>
        <div className="relative">
          <Globe2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
          <select
            data-testid="daddy-country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm appearance-none cursor-pointer focus:outline-none focus:border-[#ff8a00]/50"
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
          className="pl-3 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm appearance-none cursor-pointer focus:outline-none focus:border-[#ff8a00]/50"
        >
          <option value="">Toutes les catégories</option>
          {(data.categories || []).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <span className="ml-auto text-xs text-white/45">
          {data.channels.length} chaînes
        </span>
      </div>

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
            <DaddyCard key={c.id} ch={c} onClick={() => onPick?.(c)} />
          ))}
        </div>
      ) : (
        <div className="space-y-8" data-testid="daddy-grouped">
          {grouped.keys.map((cn) => (
            <div key={cn}>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-white text-lg font-extrabold flex items-center gap-2">
                  <FlagIcon country={cn} size={20} />
                  {cn}
                </h2>
                <span className="text-xs text-white/40">({grouped.map[cn].length})</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {grouped.map[cn].slice(0, 24).map((c) => (
                  <DaddyCard key={c.id} ch={c} onClick={() => onPick?.(c)} />
                ))}
              </div>
              {grouped.map[cn].length > 24 && (
                <button
                  onClick={() => setCountry(cn)}
                  className="mt-3 text-sm text-[#ff8a00] hover:underline"
                  data-testid={`daddy-more-${cn}`}
                >
                  Voir les {grouped.map[cn].length} chaînes de {cn} →
                </button>
              )}
            </div>
          ))}
        </div>
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
      </div>
      <div className="text-sm font-semibold text-white truncate" title={ch.name}>{ch.name}</div>
      <div className="text-[11px] text-white/50 mt-0.5 truncate flex items-center gap-1.5">
        <FlagIcon country={ch.country} size={12} />
        <span className="truncate">{ch.category} · {ch.country}</span>
      </div>
    </button>
  );
}
