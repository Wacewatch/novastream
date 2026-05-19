import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Search, Globe2, Loader2, Tv2, Users, Heart, Radio, Trophy,
  Flame, Info as InfoIcon,
} from "lucide-react";
import ChannelCard from "@/components/ChannelCard";
import AdUnlockModal from "@/components/AdUnlockModal";
import VideoPlayer from "@/components/VideoPlayer";
import IframePlayer from "@/components/IframePlayer";
import UserMenu from "@/components/UserMenu";
import FlagIcon from "@/components/FlagIcon";
import DaddyTab from "@/components/tabs/DaddyTab";
import SportsTab from "@/components/tabs/SportsTab";
import FootballTab from "@/components/tabs/FootballTab";
import InfoTab from "@/components/tabs/InfoTab";
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

const COUNTRY_FLAGS = {};
const flagFor = (c) => COUNTRY_FLAGS[c] || "";

const SPORTS_SUBTABS = [
  { id: "sports", label: "Sports", icon: Trophy },
  { id: "football", label: "Football Live", icon: Flame },
  { id: "info", label: "Informations", icon: InfoIcon },
];

export default function NovaStream() {
  // ---------- Top-level tab state ----------
  const [activeTab, setActiveTab] = useState("tv");        // tv | daddy | sports
  const [sportsSubTab, setSportsSubTab] = useState("sports"); // sports | football | info

  // ---------- TV (Vavoo) state ----------
  const [countries, setCountries] = useState(["France"]);
  const [country, setCountry] = useState("France");
  const [category, setCategory] = useState("Tous");
  const [search, setSearch] = useState("");
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total_24h: 0, live_total: 0 });
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const { favorites, isFavorite } = useFavorites();

  // ---------- Playback overlay state ----------
  // Single ad gate. Once unlocked, the corresponding overlay opens and
  // changing server/source inside it does NOT trigger the ad again.
  const [pending, setPending] = useState(null);
  // pending: { kind: 'tv'|'daddy'|'info'|'sports'|'football', payload }

  const [resolving, setResolving] = useState(false);

  // TV (HLS via Vavoo proxy)
  const [tvActive, setTvActive] = useState(null);    // channel
  const [tvStreamUrl, setTvStreamUrl] = useState(null);

  // DaddyTV / Info — iframe overlay (no server picker)
  const [daddyActive, setDaddyActive] = useState(null); // { id, name, embed_url, m3u8? }
  const [daddyHls, setDaddyHls] = useState(null);       // optional proxied HLS
  const [daddyStarted, setDaddyStarted] = useState(false); // HLS playback has started ≥ 1 frame

  // ── DaddyTV HLS watchdog ──────────────────────────────────────────────
  // If the HLS playback hasn't actually started within 30 seconds of opening
  // the overlay, automatically switch to the iframe fallback (proxyPlayerUrl).
  // Triggers also on a hard error (caught via onError below).
  useEffect(() => {
    if (!daddyActive || !daddyHls || daddyStarted) return;
    const t = setTimeout(() => {
      // Still waiting? Switch to iframe if we have one.
      if ((daddyActive?.iframe_url || daddyActive?.embed_url)) {
        setDaddyHls(null);
        toast.info("HLS lent (>30s) — passage à l'iframe…");
      }
    }, 30000);
    return () => clearTimeout(t);
  }, [daddyActive, daddyHls, daddyStarted]);

  // Sports (streamed.pk) — iframe overlay with right-side picker for sources
  const [sportsOpen, setSportsOpen] = useState(null);
  // sportsOpen: { match, sources: [{source,id,name,embedUrl}], activeSource, embedUrl, loadingStreams, streams: [...] }

  // Football (RapidAPI) — VideoPlayer with internal server picker
  const [footballOpen, setFootballOpen] = useState(null);
  // footballOpen: { match, servers: [{id,name,stream_url,url}], activeServerId, streamUrl }

  // ---------- Bootstrap ----------
  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${API}/countries`);
        const list = r.data.countries || [];
        const sorted = ["France", ...list.filter((c) => c !== "France")];
        setCountries(sorted);
      } catch (e) {
        console.error("countries error", e);
        toast.error("Impossible de charger les pays");
      }
    })();
  }, []);

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

  useEffect(() => {
    if (activeTab !== "tv") return;
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
      }
    })();
    return () => { cancelled = true; ctrl.abort(); };
  }, [activeTab, country, category, search]);

  // ---------- Pick handlers (always go through ad modal first) ----------
  const handlePickTv = (ch) => setPending({ kind: "tv", payload: ch });
  const handlePickDaddy = (ch) => setPending({ kind: "daddy", payload: ch });
  const handlePickInfo = (ch) => setPending({ kind: "info", payload: ch });
  const handlePickSports = async (match) => {
    // Pre-fetch the first source's streams so the picker is ready when ad ends.
    setPending({ kind: "sports", payload: { match, loading: true } });
    try {
      const first = (match.sources || [])[0];
      if (!first) {
        setPending({ kind: "sports", payload: { match, loading: false, streams: [], activeSource: null, embedUrl: null } });
        return;
      }
      const r = await axios.get(`${API}/sports/streams`, { params: { source: first.source, id: first.id } });
      const streams = r.data?.streams || [];
      setPending({
        kind: "sports",
        payload: { match, loading: false, streams, activeSource: first.source, embedUrl: streams[0]?.embedUrl || "" },
      });
    } catch (e) {
      console.error(e);
      setPending({ kind: "sports", payload: { match, loading: false, streams: [], activeSource: null, embedUrl: null } });
    }
  };
  const handlePickFootball = async (match) => {
    setPending({ kind: "football", payload: { match, loading: true } });
    try {
      const r = await axios.get(`${API}/football/streams`, { params: { mid: match.id } });
      const servers = (r.data?.servers || []).map((s, i) => ({
        id: `srv-${i}`,
        name: s.name,
        stream_url: s.stream_url,
        url: s.url,
      }));
      setPending({
        kind: "football",
        payload: { match, loading: false, servers, activeServerId: servers[0]?.id || null, streamUrl: servers[0]?.stream_url || null },
      });
    } catch (e) {
      console.error(e);
      setPending({ kind: "football", payload: { match, loading: false, servers: [], activeServerId: null, streamUrl: null } });
    }
  };

  // ---------- Ad unlocked → open the actual player ----------
  const handleUnlocked = async () => {
    if (!pending) return;
    const { kind, payload } = pending;
    setPending(null);

    if (kind === "tv") {
      const ch = payload;
      setResolving(true);
      try {
        const r = await axios.get(`${API}/stream/${encodeURIComponent(ch.id)}`);
        setTvStreamUrl(r.data.proxy_url);
        setTvActive(ch);
      } catch (e) {
        console.error(e);
        toast.error("Flux indisponible pour cette chaîne");
      } finally {
        setResolving(false);
      }
      return;
    }

    if (kind === "daddy" || kind === "info") {
      const ch = payload;
      // DaddyTV: try HLS resolution first (via /api/daddy/stream), fall back to
      // iframe (proxyPlayerUrl from chat.cfbu247.sbs which is iframe-friendly)
      // when HLS is unavailable or fails on the client.
      setResolving(true);
      setDaddyStarted(false);
      try {
        const r = await axios.get(`${API}/daddy/stream/${encodeURIComponent(ch.id)}`);
        const data = r.data || {};
        setDaddyActive({
          ...ch,
          embed_url: data.iframe_url || data.embed_url || ch.embed_url || "",
          iframe_url: data.iframe_url || data.embed_url || ch.embed_url || "",
        });
        setDaddyHls(data.stream_url || null);
      } catch (e) {
        console.error(e);
        // Fall back to the original embed_url from the channel card.
        setDaddyActive(ch);
        setDaddyHls(null);
      } finally {
        setResolving(false);
      }
      return;
    }

    if (kind === "sports") {
      setSportsOpen(payload);
      return;
    }

    if (kind === "football") {
      setFootballOpen(payload);
      return;
    }
  };

  const handleCancelPending = () => setPending(null);

  // ---------- Sports: switch source/server inside open overlay (no ad replay) ----------
  const sportsSwitchSource = async (src) => {
    if (!sportsOpen) return;
    setSportsOpen((s) => ({ ...s, loading: true, activeSource: src.source, embedUrl: "" }));
    try {
      const r = await axios.get(`${API}/sports/streams`, { params: { source: src.source, id: src.id } });
      const streams = r.data?.streams || [];
      setSportsOpen((s) => ({ ...s, loading: false, streams, activeSource: src.source, embedUrl: streams[0]?.embedUrl || "" }));
    } catch (e) {
      console.error(e);
      setSportsOpen((s) => ({ ...s, loading: false, streams: [], embedUrl: "" }));
    }
  };
  const sportsPickStream = (stream) => {
    setSportsOpen((s) => ({ ...s, embedUrl: stream.embedUrl || s.embedUrl }));
  };

  // ---------- Football: switch server inside VideoPlayer (no ad replay) ----------
  const footballSwitchServer = useCallback((srv) => {
    setFootballOpen((f) => f ? { ...f, activeServerId: srv.id, streamUrl: srv.stream_url } : f);
  }, []);

  // ---------- Visible TV channels ----------
  const visibleChannels = useMemo(() => {
    const live = stats?.per_channel || {};
    const base = channels.map((c) => {
      const v = live[c.id];
      return v != null && v !== c.viewers ? { ...c, viewers: v } : c;
    });
    if (onlyFavorites) return base.filter((c) => isFavorite(c.id));
    return base;
  }, [channels, stats, onlyFavorites, isFavorite]);

  return (
    <div className="relative min-h-screen text-white">
      <div className="ns-bg" />
      <div className="ns-grain" />

      {/* ===== Header (always visible) ===== */}
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

          {activeTab === "tv" && (
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
          )}

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
            <UserMenu />
          </div>
        </div>

        {activeTab === "tv" && (
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
        )}
      </header>

      {/* ===== Hub buttons (3 tabs) ===== */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 pb-2" data-testid="hub-section">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <button
            type="button"
            onClick={() => setActiveTab("tv")}
            data-testid="hub-tv"
            className={`hub-card text-left ${activeTab === "tv" ? "is-active" : ""}`}
          >
            <div className="hub-icon" style={{ background: "linear-gradient(135deg,#ff2e63 0%,#ff5470 100%)" }}>
              <Tv2 size={24} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white font-extrabold text-lg leading-tight">TV</div>
              <div className="text-white/55 text-xs mt-0.5 truncate">Chaînes en direct</div>
            </div>
            <span className="hub-chev">›</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("daddy")}
            data-testid="hub-daddy"
            className={`hub-card text-left ${activeTab === "daddy" ? "is-active" : ""}`}
          >
            <div className="hub-icon" style={{ background: "linear-gradient(135deg,#ff8a00 0%,#ff5400 100%)" }}>
              <Radio size={24} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white font-extrabold text-lg leading-tight">DaddyTV</div>
              <div className="text-white/55 text-xs mt-0.5 truncate">Chaînes mondiales en direct</div>
            </div>
            <span className="hub-chev">›</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("sports")}
            data-testid="hub-sports"
            className={`hub-card text-left ${activeTab === "sports" ? "is-active" : ""}`}
          >
            <div className="hub-icon" style={{ background: "linear-gradient(135deg,#10b981 0%,#059669 100%)" }}>
              <Trophy size={24} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white font-extrabold text-lg leading-tight">Sports</div>
              <div className="text-white/55 text-xs mt-0.5 truncate">Matchs & événements live</div>
            </div>
            <span className="hub-chev">›</span>
          </button>
        </div>
      </section>

      {/* ===== TV controls: country menu + categories (below hub) ===== */}
      {activeTab === "tv" && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 pb-2" data-testid="tv-controls">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger
                data-testid="country-filter"
                className="glass-pill border-white/10 rounded-full px-4 py-2.5 h-auto text-sm gap-2 min-w-[160px]"
              >
                <Globe2 size={16} className="text-white/60" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="glass-heavy border-white/10 max-h-[340px]">
                {countries.map((c) => (
                  <SelectItem key={c} value={c} data-testid={`country-option-${c}`}>
                    <FlagIcon country={c} size={18} className="mr-2" />
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex-1 min-w-[200px] flex gap-2 overflow-x-auto no-scrollbar">
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

            <div className="flex items-center gap-2 ml-auto">
              {stats.live_total > 0 && (
                <div
                  className="flex items-center gap-2 glass-pill px-3 py-2 rounded-full"
                  data-testid="viewers-live-total"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ff2e63] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#ff2e63]"></span>
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{stats.live_total}</span>
                  <span className="text-sm text-white/60">en direct</span>
                </div>
              )}
              <div className="flex items-center gap-2 glass-pill px-3 py-2 rounded-full" data-testid="channels-counter">
                <Tv2 size={16} className="text-[#ff2e63]" />
                <span className="text-sm font-semibold">{channels.length}</span>
                <span className="text-sm text-white/60">chaînes</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ===== Sports sub-tabs ===== */}
      {activeTab === "sports" && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 pb-2" data-testid="sports-subtabs">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {SPORTS_SUBTABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setSportsSubTab(t.id)}
                  data-testid={`tab-${t.id}`}
                  className={`tab-pill ${sportsSubTab === t.id ? "is-active" : ""}`}
                >
                  <Icon size={14} /> {t.label}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ===== Main content area (changes by tab) ===== */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pb-20 pt-4">
        {activeTab === "tv" && (
          <>
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
                  <ChannelCard key={ch.id} channel={ch} onClick={() => handlePickTv(ch)} />
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "daddy" && (
          <DaddyTab onPick={handlePickDaddy} />
        )}

        {activeTab === "sports" && sportsSubTab === "sports" && (
          <SportsTab onPickMatch={handlePickSports} />
        )}
        {activeTab === "sports" && sportsSubTab === "football" && (
          <FootballTab onPickMatch={handlePickFootball} />
        )}
        {activeTab === "sports" && sportsSubTab === "info" && (
          <InfoTab onResolveChannel={handlePickInfo} />
        )}
      </main>

      <footer className="max-w-7xl mx-auto px-4 sm:px-6 pb-10 text-center">
        <p className="text-white/40 text-xs">© {new Date().getFullYear()} LiveWatch — Diffusion en direct. Tous droits réservés.</p>
      </footer>

      {/* ===== Resolving overlay ===== */}
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

      {/* ===== AdUnlock modal (single, kind-aware) ===== */}
      {pending && (
        <AdUnlockModal
          channel={pendingChannelLabel(pending)}
          onUnlocked={handleUnlocked}
          onCancel={handleCancelPending}
        />
      )}

      {/* ===== TV player (HLS) ===== */}
      {tvActive && tvStreamUrl && (
        <VideoPlayer
          channel={tvActive}
          streamUrl={tvStreamUrl}
          onClose={() => { setTvActive(null); setTvStreamUrl(null); }}
          onRetry={async () => {
            try {
              const r = await axios.get(`${API}/stream/${encodeURIComponent(tvActive.id)}`);
              setTvStreamUrl(`${r.data.proxy_url}&_t=${Date.now()}`);
            } catch (e) {
              console.error(e);
              toast.error("Impossible de relancer le flux");
            }
          }}
        />
      )}

      {/* ===== DaddyTV / Info player ===== */}
      {daddyActive && daddyHls && (
        <VideoPlayer
          channel={{ id: daddyActive.id, name: daddyActive.name, country_code: "daddy" }}
          streamUrl={daddyHls}
          onClose={() => { setDaddyActive(null); setDaddyHls(null); setDaddyStarted(false); }}
          onStarted={() => setDaddyStarted(true)}
          onError={() => {
            // HLS failed: switch to iframe fallback if available.
            if (daddyActive?.iframe_url || daddyActive?.embed_url) {
              setDaddyHls(null);
              toast.info("Lecture HLS indisponible — passage à l'iframe…");
            }
          }}
          onRetry={async () => {
            try {
              const r = await axios.get(`${API}/daddy/stream/${encodeURIComponent(daddyActive.id)}`);
              if (r.data?.stream_url) {
                setDaddyStarted(false);
                setDaddyHls(`${r.data.stream_url}&_t=${Date.now()}`);
              } else {
                setDaddyHls(null); // fall back to iframe
              }
            } catch (_) {
              setDaddyHls(null); // fall back to iframe
            }
          }}
        />
      )}
      {daddyActive && !daddyHls && (daddyActive.iframe_url || daddyActive.embed_url) && (
        <IframePlayer
          src={daddyActive.iframe_url || daddyActive.embed_url}
          title={`${daddyActive.name} — DaddyTV`}
          onClose={() => setDaddyActive(null)}
        />
      )}

      {/* ===== Sports overlay (iframe + source/stream picker) ===== */}
      {sportsOpen && (
        <IframePlayer
          src={sportsOpen.embedUrl || ""}
          title={sportsOpen.match.title || "Match en direct"}
          onClose={() => setSportsOpen(null)}
          rightSlot={
            <SportsPickerInline
              match={sportsOpen.match}
              streams={sportsOpen.streams || []}
              activeSource={sportsOpen.activeSource}
              loading={!!sportsOpen.loading}
              onSwitchSource={sportsSwitchSource}
              onPickStream={sportsPickStream}
              currentEmbedUrl={sportsOpen.embedUrl || ""}
            />
          }
        />
      )}

      {/* ===== Football overlay (VideoPlayer + inline server selector) ===== */}
      {footballOpen && footballOpen.streamUrl && (
        <VideoPlayer
          channel={{ id: footballOpen.match.id, name: footballOpen.match.title, country_code: "fb" }}
          streamUrl={footballOpen.streamUrl}
          servers={footballOpen.servers}
          activeServerId={footballOpen.activeServerId}
          onSwitchServer={footballSwitchServer}
          onClose={() => setFootballOpen(null)}
          onRetry={() => {
            const cur = footballOpen.servers.find((s) => s.id === footballOpen.activeServerId);
            if (cur) {
              setFootballOpen({ ...footballOpen, streamUrl: `${cur.stream_url}&_t=${Date.now()}` });
            }
          }}
        />
      )}
      {footballOpen && !footballOpen.streamUrl && !footballOpen.loading && (
        <FootballNoServersOverlay match={footballOpen.match} onClose={() => setFootballOpen(null)} />
      )}
    </div>
  );
}

// ===== helpers =====

function pendingChannelLabel(p) {
  if (!p) return { name: "" };
  switch (p.kind) {
    case "tv":
    case "daddy":
    case "info":
      return p.payload || { name: "" };
    case "sports":
      return { name: p.payload?.match?.title || "Match" };
    case "football":
      return { name: p.payload?.match?.title || "Match" };
    default:
      return { name: "" };
  }
}

function SportsPickerInline({ match, streams, activeSource, loading, onSwitchSource, onPickStream, currentEmbedUrl }) {
  return (
    <div className="flex items-center gap-2 max-w-full overflow-x-auto no-scrollbar">
      {(match.sources || []).length > 1 && (
        <div className="flex items-center gap-1 shrink-0">
          {match.sources.map((s, idx) => (
            <button
              key={`${s.source}-${idx}`}
              onClick={() => onSwitchSource(s)}
              className={`source-chip whitespace-nowrap ${activeSource === s.source ? "is-active" : ""}`}
              data-testid={`src-${s.source}`}
              title={`Source ${s.source}`}
            >
              {s.source}
            </button>
          ))}
        </div>
      )}
      {loading ? (
        <Loader2 size={14} className="animate-spin text-emerald-400 shrink-0" />
      ) : (
        <div className="flex items-center gap-1 shrink-0">
          {streams.slice(0, 6).map((stream, idx) => (
            <button
              key={idx}
              onClick={() => onPickStream(stream)}
              className={`source-chip whitespace-nowrap ${
                currentEmbedUrl === stream.embedUrl ? "is-active" : ""
              }`}
              data-testid={`stream-${idx}`}
              title={`Stream ${(stream.streamNo || idx) + 1}`}
            >
              {stream.hd ? "HD" : "SD"} #{(stream.streamNo || idx) + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FootballNoServersOverlay({ match, onClose }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="glass-heavy rounded-2xl p-6 max-w-md text-center" onClick={(e) => e.stopPropagation()}>
        <div className="text-white font-extrabold mb-2">{match.title}</div>
        <p className="text-white/70 text-sm mb-4">Aucun serveur disponible pour ce match.</p>
        <button onClick={onClose} className="ad-btn-secondary">Fermer</button>
      </div>
    </div>
  );
}
