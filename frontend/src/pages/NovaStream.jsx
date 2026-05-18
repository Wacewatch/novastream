import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Search, Globe2, Loader2, Tv2 } from "lucide-react";
import ChannelCard from "@/components/ChannelCard";
import AdUnlockModal from "@/components/AdUnlockModal";
import VideoPlayer from "@/components/VideoPlayer";
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

  // Load channels when filters change
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const params = { country, limit: 800 };
        if (category && category !== "Tous") params.category = category;
        if (search.trim()) params.search = search.trim();
        const r = await axios.get(`${API}/channels`, { params, signal: ctrl.signal });
        setChannels(r.data.channels || []);
      } catch (e) {
        if (e.name !== "CanceledError" && e.code !== "ERR_CANCELED") {
          console.error("channels error", e);
          toast.error("Erreur lors du chargement des chaînes");
        }
      } finally {
        setLoading(false);
      }
    })();
    return () => ctrl.abort();
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

  const visibleChannels = useMemo(() => channels, [channels]);

  return (
    <div className="relative min-h-screen text-white">
      <div className="ns-bg" />
      <div className="ns-grain" />

      {/* Header */}
      <header className="sticky top-0 z-40 glass" style={{ borderRadius: 0, backdropFilter: "blur(22px) saturate(140%)" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3 sm:gap-6">
          <div className="flex items-center gap-2.5 shrink-0" data-testid="brand-logo">
            <span className="brand-dot" />
            <span className="text-xl sm:text-2xl font-extrabold tracking-tight" style={{ fontFamily: "Outfit, sans-serif" }}>
              NovaStream
            </span>
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

          <div className="ml-auto md:ml-0 shrink-0">
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
          <div className="flex items-center gap-2 glass-pill px-4 py-2 rounded-full self-start sm:self-end" data-testid="channels-counter">
            <Tv2 size={16} className="text-[#ff2e63]" />
            <span className="text-sm font-semibold">{channels.length}</span>
            <span className="text-sm text-white/60">chaînes</span>
          </div>
        </div>
      </section>

      {/* Channel grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-20">
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
        <p className="text-white/40 text-xs">© {new Date().getFullYear()} NovaStream — Diffusion en direct. Tous droits réservés.</p>
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
        <VideoPlayer channel={activeChannel} streamUrl={streamUrl} onClose={handleClosePlayer} />
      )}
    </div>
  );
}
