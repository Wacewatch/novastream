import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { Search, Globe2, Loader2, Tv2, Users, Heart, Radio, Trophy } from "lucide-react";
import ChannelCard from "@/components/ChannelCard";
import AdUnlockModal from "@/components/AdUnlockModal";
import VideoPlayer from "@/components/VideoPlayer";
import UserMenu from "@/components/UserMenu";
import { useFavorites } from "@/hooks/useFavorites";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const DEFAULT_CATEGORIES = [
  "Tous",
  "Généralistes",
  "Sport",
  "Info",
  "Cinéma",
  "Jeunesse",
  "Divertissement",
  "Documentaire",
  "Musique",
];

// Country to flag emoji
const COUNTRY_FLAGS = {
  France: "🇫🇷",
  Germany: "🇩🇪",
  Italy: "🇮🇹",
  Spain: "🇪🇸",
  "United Kingdom": "🇬🇧",
  "United States": "🇺🇸",
  Portugal: "🇵🇹",
  Netherlands: "🇳🇱",
  Belgium: "🇧🇪",
  Switzerland: "🇨🇭",
  Poland: "🇵🇱",
  Russia: "🇷🇺",
  Turkey: "🇹🇷",
  Romania: "🇷🇴",
  Greece: "🇬🇷",
  Austria: "🇦🇹",
  Sweden: "🇸🇪",
  Denmark: "🇩🇰",
  Norway: "🇳🇴",
  Finland: "🇫🇮",
  Albania: "🇦🇱",
  Arabia: "🇸🇦",
  Bulgaria: "🇧🇬",
  Czech: "🇨🇿",
  Croatia: "🇭🇷",
  Hungary: "🇭🇺",
  Ireland: "🇮🇪",
  Serbia: "🇷🇸",
  Ukraine: "🇺🇦",
  India: "🇮🇳",
  Brazil: "🇧🇷",
  Mexico: "🇲🇽",
  Argentina: "🇦🇷",
  Canada: "🇨🇦",
  Australia: "🇦🇺",
};

const flagFor = (c) => COUNTRY_FLAGS[c] || "📺";

export default function NovaStream() {
  const [countries, setCountries] = useState(["France"]);
  const [country, setCountry] = useState("France");
  const [category, setCategory] = useState("Tous");
  const [search, setSearch] = useState("");
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total_24h: 0, live_total: 0 });
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const { favorites, isFavorite } = useFavorites();

  // Playback state
  const [pendingChannel, setPendingChannel] = useState(null); // showing ad modal
  const [activeChannel, setActiveChannel] = useState(null); // currently playing
  const [streamUrl, setStreamUrl] = useState(null);
  const [resolving, setResolving] = useState(false);

  // Load countries once
  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${API}/countries`);
        const list = r.data.countries || [];
        // Put France first
        const sorted = ["France", ...list.filter((c) => c !== "France")];
        setCountries(sorted);
      } catch (e) {
        console.error("countries error", e);
        toast.error("Impossible de charger les pays");
      }
    })();
  }, []);

  // Live stats — total 24h viewers + currently watching. Refresh every 20 s.
  useEffect(() => {
    let mounted = true;
    const fetchStats = async () => {
      try {
        const r = await axios.get(`${API}/stats`);
        if (mounted) setStats(r.data || { total_24h: 0, live_total: 0 });
      } catch (_) { /* silent */ }
    };
    fetchStats();
    const id = setInterval(fetchStats, 5000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  // Load channels when filters change
  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = { country, limit: 0 };
        if (category && category !== "Tous") params.category = category;
        if (search.trim()) params.search = search.trim();
        const r = await axios.get(`${API}/channels`, { params, signal: ctrl.signal });
        if (cancelled) return;
        setChannels(r.data.channels || []);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        if (e.name !== "CanceledError" && e.code !== "ERR_CANCELED") {
          console.error("channels error", e);
          toast.error("Erreur lors du chargement des chaînes");
          setLoading(false);
        }
        // On abort: keep loading=true so we don't flash the empty state
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [country, category, search]);

  const handleChannelClick = (ch) => {
    // Always go through the 2-step ad flow on each channel selection
    setActiveChannel(null);
    setStreamUrl(null);
    setPendingChannel(ch);
  };

  const handleUnlocked = async () => {
    if (!pendingChannel) return;
    const ch = pendingChannel;
    setPendingChannel(null);
    setResolving(true);
    try {
      const r = await axios.get(`${API}/stream/${encodeURIComponent(ch.id)}`);
      setStreamUrl(r.data.proxy_url);
      setActiveChannel(ch);
    } catch (e) {
      console.error("resolve error", e);
      toast.error("Flux indisponible pour cette chaîne");
    } finally {
      setResolving(false);
    }
  };

  const handleClosePlayer = () => {
    setActiveChannel(null);
    setStreamUrl(null);
  };

  const visibleChannels = useMemo(() => {
    const live = stats?.per_channel || {};
    const base = channels.map((c) => {
      const v = live[c.id];
      return v != null && v !== c.viewers ? { ...c, viewers: v } : c;
    });
    if (onlyFavorites) {
      return base.filter((c) => isFavorite(c.id));
    }
    return base;
  }, [channels, stats, onlyFavorites, isFavorite]);

  return (
    <div className="relative min-h-screen text-white">
      <div className="ns-bg" />
      <div className="ns-grain" />

      {/* Header */}
      <header className="sticky top-0 z-40 glass" style={{ borderRadius: 0, backdropFilter: "blur(22px) saturate(140%)" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3 sm:gap-6">
          <div className="flex items-center gap-2.5 shrink-0" data-testid="brand-logo">
            <img
              src="https://i.imgur.com/V8YmT4z.png"
              alt="LiveWatch"
              className="h-7 sm:h-8 w-auto"
              draggable={false}
            />
          </div>

          <div className="hidden md:flex flex-1 max-w-md mx-auto">
            <div className="relative w-full">
              <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/50" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher une chaîne…"
                data-testid="search-input"
                className="w-full pl-10 pr-4 py-2.5 rounded-full glass-pill text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/20"
              />
            </div>
          </div>

          <div className="ml-auto md:ml-0 shrink-0 flex items-center gap-2">
            <div
              className="hidden lg:flex items-center gap-2 px-3 py-2 rounded-full glass-pill border-white/10"
              data-testid="viewers-stat-24h"
              title="Spectateurs uniques sur les dernières 24 heures"
            >
              <Users size={14} className="text-[#ff2e63]" />
              <span className="text-sm font-bold tabular-nums">{stats.total_24h.toLocaleString("fr-FR")}</span>
              <span className="text-[11px] text-white/55 uppercase tracking-wider">vues / 24 h</span>
            </div>
            <a
              href="/multiview"
              className="hidden sm:inline-flex items-center gap-1.5 text-sm text-white/70 hover:text-white px-3 py-2 rounded-full glass-pill border-white/10 transition-colors"
              data-testid="multiview-link"
              title="Mode multiview (jusqu'à 4×4)"
            >
              <Tv2 size={14} className="text-[#ff2e63]" />
              Multi
            </a>
            <button
              onClick={() => setOnlyFavorites((v) => !v)}
              className={`hidden sm:inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-full glass-pill border-white/10 transition-colors ${
                onlyFavorites ? "text-[#ff2e63] border-[#ff2e63]/40" : "text-white/70 hover:text-white"
              }`}
              data-testid="favorites-filter-btn"
              title={onlyFavorites ? "Afficher toutes les chaînes" : "Afficher mes favoris"}
            >
              <Heart
                size={14}
                fill={onlyFavorites ? "#ff2e63" : "transparent"}
                color={onlyFavorites ? "#ff2e63" : "currentColor"}
                strokeWidth={onlyFavorites ? 0 : 2}
              />
              <span>{favorites.length}</span>
            </button>
            <a
              href="/docs"
              className="hidden sm:inline-flex items-center gap-1.5 text-sm text-white/70 hover:text-white px-3 py-2 rounded-full glass-pill border-white/10 transition-colors"
              data-testid="api-link"
            >
              API
            </a>
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger
                data-testid="country-filter"
                className="glass-pill border-white/10 rounded-full px-4 py-2.5 h-auto text-sm gap-2 min-w-[140px]"
              >
                <Globe2 size={16} className="text-white/60" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="glass-heavy border-white/10 max-h-[340px]">
                {countries.map((c) => (
                  <SelectItem key={c} value={c} data-testid={`country-option-${c}`}>
                    <span className="mr-2">{flagFor(c)}</span>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <UserMenu />
          </div>
        </div>

        {/* Mobile search */}
        <div className="md:hidden px-4 pb-3">
          <div className="relative">
            <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/50" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une chaîne…"
              data-testid="search-input-mobile"
              className="w-full pl-10 pr-4 py-2.5 rounded-full glass-pill text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/20"
            />
          </div>
        </div>

        {/* Categories */}
        <div className="border-t border-white/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex gap-2 overflow-x-auto no-scrollbar">
            {DEFAULT_CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                data-testid={`category-pill-${cat}`}
                className={`cat-pill glass-pill ${category === cat ? "active" : ""}`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Hero strip */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-8 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <p className="text-white/50 uppercase tracking-[0.2em] text-xs mb-2">Direct • {flagFor(country)} {country}</p>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight" style={{ fontFamily: "Outfit, sans-serif" }}>
              Toutes vos chaînes <span className="text-[#ff2e63]">en direct</span>
            </h1>
            <p className="text-white/55 mt-2 text-sm sm:text-base">Choisissez une chaîne pour démarrer la diffusion immédiatement.</p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-end">
            {stats.live_total > 0 && (
              <div
                className="flex items-center gap-2 glass-pill px-4 py-2 rounded-full"
                data-testid="viewers-live-total"
                title="Spectateurs actuellement en train de regarder"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ff2e63] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#ff2e63]"></span>
                </span>
                <span className="text-sm font-semibold tabular-nums">{stats.live_total}</span>
                <span className="text-sm text-white/60">en direct</span>
              </div>
            )}
            <div className="flex items-center gap-2 glass-pill px-4 py-2 rounded-full" data-testid="channels-counter">
              <Tv2 size={16} className="text-[#ff2e63]" />
              <span className="text-sm font-semibold">{channels.length}</span>
              <span className="text-sm text-white/60">chaînes</span>
            </div>
          </div>
        </div>
      </section>

      {/* Hub buttons — 3 sections: TV / DaddyTV / Sports */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-2" data-testid="hub-section">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <a
            href="#tv-grid"
            data-testid="hub-tv"
            className="hub-card group"
            onClick={(e) => {
              e.preventDefault();
              const el = document.getElementById("tv-grid");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            <div className="hub-icon" style={{ background: "linear-gradient(135deg,#ff2e63 0%,#ff5470 100%)" }}>
              <Tv2 size={24} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white font-extrabold text-lg leading-tight">TV</div>
              <div className="text-white/55 text-xs mt-0.5 truncate">Chaînes en direct (Vavoo)</div>
            </div>
            <span className="hub-chev">›</span>
          </a>

          <Link to="/daddy" data-testid="hub-daddy" className="hub-card group">
            <div className="hub-icon" style={{ background: "linear-gradient(135deg,#ff8a00 0%,#ff5400 100%)" }}>
              <Radio size={24} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-white font-extrabold text-lg leading-tight">DaddyTV</span>
                <span className="badge-pub">PUB</span>
              </div>
              <div className="text-white/55 text-xs mt-0.5 truncate">800+ chaînes TV en direct</div>
            </div>
            <span className="hub-chev">›</span>
          </Link>

          <Link to="/sports" data-testid="hub-sports" className="hub-card group">
            <div className="hub-icon" style={{ background: "linear-gradient(135deg,#10b981 0%,#059669 100%)" }}>
              <Trophy size={24} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-white font-extrabold text-lg leading-tight">Sports</span>
                <span className="badge-pub">PUB</span>
              </div>
              <div className="text-white/55 text-xs mt-0.5 truncate">Matchs & événements live</div>
            </div>
            <span className="hub-chev">›</span>
          </Link>
        </div>
      </section>
      <section id="tv-grid" className="max-w-7xl mx-auto px-4 sm:px-6 pb-20 pt-6">
        {loading ? (
          <div className="flex items-center justify-center py-20" data-testid="loading-state">
            <Loader2 className="animate-spin text-[#ff2e63]" size={32} />
            <span className="ml-3 text-white/60">Chargement des chaînes…</span>
          </div>
        ) : channels.length === 0 ? (
          <div className="glass rounded-2xl p-10 text-center" data-testid="empty-state">
            <Tv2 className="mx-auto text-white/30 mb-3" size={36} />
            <p className="text-white/70">Aucune chaîne ne correspond à votre recherche.</p>
            <p className="text-white/40 text-sm mt-1">Essayez un autre pays ou catégorie.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5">
            {visibleChannels.map((ch) => (
              <ChannelCard key={ch.id} channel={ch} onClick={() => handleChannelClick(ch)} />
            ))}
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 pb-10 text-center">
        <p className="text-white/40 text-xs">© {new Date().getFullYear()} LiveWatch — Diffusion en direct. Tous droits réservés.</p>
      </footer>

      {/* Resolving indicator */}
      {resolving && (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center" data-testid="resolving-overlay">
          <div className="glass-heavy rounded-2xl px-8 py-6 flex items-center gap-4">
            <div className="spinner" />
            <div>
              <p className="text-white font-semibold">Préparation du flux…</p>
              <p className="text-white/50 text-sm">Veuillez patienter quelques instants.</p>
            </div>
          </div>
        </div>
      )}

      {/* Ad unlock modal */}
      {pendingChannel && (
        <AdUnlockModal
          channel={pendingChannel}
          onUnlocked={handleUnlocked}
          onCancel={() => setPendingChannel(null)}
        />
      )}

      {/* Video player */}
      {activeChannel && streamUrl && (
        <VideoPlayer
          channel={activeChannel}
          streamUrl={streamUrl}
          onClose={handleClosePlayer}
          onRetry={async () => {
            try {
              const r = await axios.get(`${API}/stream/${encodeURIComponent(activeChannel.id)}`);
              setStreamUrl(`${r.data.proxy_url}&_t=${Date.now()}`);
            } catch (e) {
              console.error(e);
              toast.error("Impossible de relancer le flux");
            }
          }}
        />
      )}
    </div>
  );
}
