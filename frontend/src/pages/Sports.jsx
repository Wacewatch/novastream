import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import {
  ArrowLeft, Loader2, Trophy, Tv2, Info as InfoIcon,
  Calendar, Radio, Flame, Search,
} from "lucide-react";
import { toast } from "sonner";
import AdUnlockModal from "@/components/AdUnlockModal";
import IframePlayer from "@/components/IframePlayer";
import VideoPlayer from "@/components/VideoPlayer";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const TABS = [
  { id: "sports", label: "Sports", icon: Trophy },
  { id: "football", label: "Football Live", icon: Flame },
  { id: "info", label: "Informations", icon: InfoIcon },
];

export default function Sports() {
  const [tab, setTab] = useState("sports");

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
              style={{ background: "linear-gradient(135deg,#10b981 0%,#059669 100%)" }}
            >
              <Trophy size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <div className="font-extrabold tracking-tight text-xl">Sports</div>
                <span className="badge-pub">PUB</span>
              </div>
              <div className="text-xs text-white/55 -mt-0.5">Matchs & événements en direct</div>
            </div>
          </div>
        </div>

        <div className="border-t border-white/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex gap-2 overflow-x-auto no-scrollbar">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  data-testid={`tab-${t.id}`}
                  className={`tab-pill ${tab === t.id ? "is-active" : ""}`}
                >
                  <Icon size={14} /> {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-20">
        {tab === "sports" && <SportsTab />}
        {tab === "football" && <FootballTab />}
        {tab === "info" && <InfoTab />}
      </main>
    </div>
  );
}

// ===================== Sports tab (streamed.pk) =====================
function SportsTab() {
  const [data, setData] = useState({ events: [], sports: [], sportCounts: {} });
  const [loading, setLoading] = useState(true);
  const [sport, setSport] = useState("");
  const [search, setSearch] = useState("");
  const [pendingMatch, setPendingMatch] = useState(null);
  const [openMatch, setOpenMatch] = useState(null);
  const [streams, setStreams] = useState([]);
  const [activeSource, setActiveSource] = useState(null);
  const [loadingStreams, setLoadingStreams] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await axios.get(`${API}/sports/matches`, { params: sport ? { sport } : {} });
        if (!cancelled) setData(r.data);
      } catch (e) {
        console.error(e);
        if (!cancelled) toast.error("Erreur de chargement Sports");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sport]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.events;
    return (data.events || []).filter((e) =>
      (e.title || "").toLowerCase().includes(q) ||
      (e.home || "").toLowerCase().includes(q) ||
      (e.away || "").toLowerCase().includes(q)
    );
  }, [data.events, search]);

  const popular = filtered.filter((e) => e.popular).slice(0, 12);
  const live = filtered.filter((e) => e.isLive);

  const openMatchModal = async (m) => {
    setOpenMatch(m);
    setStreams([]);
    setActiveSource(null);
    if (!m.sources || m.sources.length === 0) return;
    setLoadingStreams(true);
    try {
      const first = m.sources[0];
      const r = await axios.get(`${API}/sports/streams`, { params: { source: first.source, id: first.id } });
      setStreams(r.data.streams || []);
      setActiveSource(first.source);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingStreams(false);
    }
  };

  const switchSource = async (src) => {
    if (!openMatch) return;
    setActiveSource(src.source);
    setLoadingStreams(true);
    setStreams([]);
    try {
      const r = await axios.get(`${API}/sports/streams`, { params: { source: src.source, id: src.id } });
      setStreams(r.data.streams || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingStreams(false);
    }
  };

  const playStream = (stream) => {
    setPendingMatch({ name: openMatch.title, embed_url: stream.embedUrl });
  };

  const handleUnlocked = () => {
    if (pendingMatch?.embed_url) {
      // Replace openMatch with iframe player
      setOpenMatch({ ...openMatch, _activeStream: pendingMatch });
    }
    setPendingMatch(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="sports-loading">
        <Loader2 className="animate-spin text-emerald-400" size={32} />
        <span className="ml-3 text-white/60">Chargement des matchs…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="sports-content">
      {/* Sport filters */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setSport("")}
          className={`tab-pill ${!sport ? "is-active" : ""}`}
          data-testid="sport-all"
        >
          Tous ({data.events?.length || 0})
        </button>
        {(data.sports || []).map((s) => (
          <button
            key={s}
            onClick={() => setSport(s)}
            className={`tab-pill ${sport === s ? "is-active" : ""}`}
            data-testid={`sport-${s}`}
          >
            {capitalize(s)} ({data.sportCounts?.[s] || 0})
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
        <input
          data-testid="sports-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un match…"
          className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-emerald-500/50"
        />
      </div>

      {/* Popular */}
      {popular.length > 0 && (
        <section data-testid="sports-popular">
          <h3 className="text-white font-extrabold mb-3 flex items-center gap-2">
            <Flame size={16} className="text-orange-400" /> Populaires ({popular.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {popular.map((m) => <MatchCard key={`pop-${m.id}`} m={m} onClick={() => openMatchModal(m)} />)}
          </div>
        </section>
      )}

      {/* Live */}
      {live.length > 0 && (
        <section data-testid="sports-live">
          <h3 className="text-white font-extrabold mb-3 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> LIVE
            </span>
            ({live.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {live.map((m) => <MatchCard key={`live-${m.id}`} m={m} onClick={() => openMatchModal(m)} />)}
          </div>
        </section>
      )}

      {/* All */}
      <section data-testid="sports-all">
        <h3 className="text-white font-extrabold mb-3 flex items-center gap-2">
          <Trophy size={16} className="text-emerald-400" /> Tous les matchs ({filtered.length})
        </h3>
        {filtered.length === 0 ? (
          <div className="glass rounded-2xl p-10 text-center">
            <div className="text-white/80 font-semibold">Aucun match trouvé</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {filtered.map((m) => <MatchCard key={m.id} m={m} onClick={() => openMatchModal(m)} />)}
          </div>
        )}
      </section>

      {/* Stream modal */}
      {openMatch && !openMatch._activeStream && (
        <StreamPicker
          match={openMatch}
          streams={streams}
          activeSource={activeSource}
          loading={loadingStreams}
          onPick={playStream}
          onSwitchSource={switchSource}
          onClose={() => setOpenMatch(null)}
        />
      )}

      {pendingMatch && (
        <AdUnlockModal
          channel={{ name: pendingMatch.name }}
          onUnlocked={handleUnlocked}
          onCancel={() => setPendingMatch(null)}
        />
      )}

      {openMatch?._activeStream?.embed_url && (
        <IframePlayer
          src={openMatch._activeStream.embed_url}
          title={openMatch.title}
          onClose={() => setOpenMatch(null)}
        />
      )}
    </div>
  );
}

function MatchCard({ m, onClick }) {
  return (
    <button
      onClick={onClick}
      data-testid={`match-${m.id}`}
      className={`match-card ${m.isLive ? "live" : ""}`}
    >
      <span className="league-tag">{m.isLive ? "LIVE" : (m.sport || "Sports")}</span>
      <div className="team-row">
        {m.homeBadge ? <img src={m.homeBadge} alt="" loading="lazy" /> : <span className="w-[22px] h-[22px] inline-block" />}
        <span className="team-name">{m.home || "—"}</span>
      </div>
      <div className="team-row">
        {m.awayBadge ? <img src={m.awayBadge} alt="" loading="lazy" /> : <span className="w-[22px] h-[22px] inline-block" />}
        <span className="team-name">{m.away || "—"}</span>
      </div>
      <div className="flex items-center justify-between text-[11px] text-white/55 mt-1">
        <span className="inline-flex items-center gap-1"><Calendar size={11} /> {m.time || "—"}</span>
        {m.sources?.length > 0 && <span>{m.sources.length} src</span>}
      </div>
    </button>
  );
}

function StreamPicker({ match, streams, activeSource, loading, onPick, onSwitchSource, onClose }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={onClose} data-testid="stream-picker">
      <div className="glass-heavy rounded-2xl p-5 max-w-2xl w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="text-xs text-white/55 uppercase font-semibold">{match.sport}</div>
            <div className="text-white font-extrabold text-lg">{match.title}</div>
            <div className="text-xs text-white/50">{match.time}</div>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white" data-testid="picker-close">✕</button>
        </div>

        {(match.sources || []).length > 1 && (
          <div className="mb-4">
            <div className="text-xs text-white/55 mb-2 uppercase font-semibold">Sources</div>
            <div className="flex flex-wrap gap-2">
              {match.sources.map((s, idx) => (
                <button
                  key={`${s.source}-${s.id}-${idx}`}
                  onClick={() => onSwitchSource(s)}
                  className={`source-chip ${activeSource === s.source ? "is-active" : ""}`}
                  data-testid={`src-${s.source}`}
                >
                  {s.source}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="text-xs text-white/55 mb-2 uppercase font-semibold">Streams</div>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin text-emerald-400" size={24} />
          </div>
        ) : streams.length === 0 ? (
          <div className="text-white/50 text-sm py-4">Aucun stream disponible</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {streams.map((s, idx) => (
              <button
                key={idx}
                onClick={() => onPick(s)}
                className="glass-pill justify-center"
                style={{ padding: "0.6rem 0.85rem" }}
                data-testid={`stream-${idx}`}
              >
                <Radio size={14} className="text-emerald-400" />
                {s.hd ? "HD" : "SD"} · {s.language || "—"} #{(s.streamNo || idx) + 1}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ===================== Football Live tab (RapidAPI) =====================
function FootballTab() {
  const [data, setData] = useState({ matches: [], leagues: [] });
  const [loading, setLoading] = useState(true);
  const [league, setLeague] = useState("");
  const [search, setSearch] = useState("");
  const [openMatch, setOpenMatch] = useState(null);
  const [servers, setServers] = useState([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [pending, setPending] = useState(null);
  const [stream, setStream] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await axios.get(`${API}/football/matches`);
        if (!cancelled) setData(r.data);
      } catch (e) {
        console.error(e);
        if (!cancelled) toast.error("Football indisponible");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data.matches || []).filter((m) => {
      if (league && m.league !== league) return false;
      if (q && !((m.home || "").toLowerCase().includes(q) || (m.away || "").toLowerCase().includes(q) || (m.league || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [data.matches, league, search]);

  const liveMatches = filtered.filter((m) => m.is_live);
  const upcoming = filtered.filter((m) => !m.is_live);

  const openMatchModal = async (m) => {
    setOpenMatch(m);
    setServers([]);
    setLoadingServers(true);
    try {
      const r = await axios.get(`${API}/football/streams`, { params: { mid: m.id } });
      setServers(r.data.servers || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingServers(false);
    }
  };

  const play = (s) => setPending({ name: openMatch.title, url: s.stream_url || s.url });

  const handleUnlocked = () => {
    if (pending?.url) setStream({ name: pending.name, url: pending.url });
    setPending(null);
    setOpenMatch(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="football-loading">
        <Loader2 className="animate-spin text-orange-400" size={32} />
        <span className="ml-3 text-white/60">Chargement Football Live…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="football-content">
      {data.from_stale && (
        <div className="glass rounded-xl px-4 py-2 text-xs text-yellow-300/90 border border-yellow-500/20 bg-yellow-500/5">
          Cache obsolète affiché — les clés RapidAPI sont peut-être épuisées. (admins : vérifier la page Admin → Football API)
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setLeague("")}
          className={`tab-pill ${!league ? "is-active" : ""}`}
        >
          Toutes ({filtered.length})
        </button>
        {(data.leagues || []).slice(0, 18).map((l) => (
          <button
            key={l}
            onClick={() => setLeague(l)}
            className={`tab-pill ${league === l ? "is-active" : ""}`}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
        <input
          data-testid="football-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher une équipe, une ligue…"
          className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-orange-500/50"
        />
      </div>

      {liveMatches.length > 0 && (
        <section>
          <h3 className="text-white font-extrabold mb-3 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> LIVE
            </span>
            ({liveMatches.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {liveMatches.map((m) => <FootballCard key={`live-${m.id}`} m={m} onClick={() => openMatchModal(m)} />)}
          </div>
        </section>
      )}

      <section>
        <h3 className="text-white font-extrabold mb-3 flex items-center gap-2">
          <Flame size={16} className="text-orange-400" /> À venir ({upcoming.length})
        </h3>
        {upcoming.length === 0 ? (
          <div className="glass rounded-2xl p-10 text-center">
            <div className="text-white/80 font-semibold">Aucun match à venir</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {upcoming.map((m) => <FootballCard key={m.id} m={m} onClick={() => openMatchModal(m)} />)}
          </div>
        )}
      </section>

      {openMatch && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={() => setOpenMatch(null)}>
          <div className="glass-heavy rounded-2xl p-5 max-w-xl w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <div className="text-xs text-white/55 uppercase font-semibold">{openMatch.league}</div>
                <div className="text-white font-extrabold text-lg">{openMatch.title}</div>
                <div className="text-xs text-white/50">{openMatch.time_label} {openMatch.is_live ? "· LIVE" : ""}</div>
              </div>
              <button onClick={() => setOpenMatch(null)} className="text-white/70 hover:text-white">✕</button>
            </div>
            <div className="text-xs text-white/55 mb-2 uppercase font-semibold">Serveurs</div>
            {loadingServers ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="animate-spin text-orange-400" size={24} />
              </div>
            ) : servers.length === 0 ? (
              <div className="text-white/50 text-sm py-4">Aucun serveur disponible</div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {servers.map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => play(s)}
                    className="glass-pill justify-center"
                    style={{ padding: "0.6rem 0.85rem" }}
                    data-testid={`fb-server-${idx}`}
                  >
                    <Tv2 size={14} className="text-orange-400" /> {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {pending && (
        <AdUnlockModal
          channel={{ name: pending.name }}
          onUnlocked={handleUnlocked}
          onCancel={() => setPending(null)}
        />
      )}

      {stream && (
        <VideoPlayer
          channel={{ name: stream.name, country_code: "fb" }}
          streamUrl={stream.url}
          onClose={() => setStream(null)}
          onRetry={() => setStream({ ...stream })}
        />
      )}
    </div>
  );
}

function FootballCard({ m, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`match-card ${m.is_live ? "live" : ""}`}
      data-testid={`fb-card-${m.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="league-tag">{m.is_live ? "LIVE" : (m.league || "Football")}</span>
        <span className="text-[11px] text-white/55">{m.time_label}</span>
      </div>
      <div className="flex items-center gap-3 mt-2">
        <div className="flex-1 flex flex-col gap-1">
          <div className="team-row">
            {m.home_logo ? <img src={m.home_logo} alt="" loading="lazy" /> : <span className="w-[22px] h-[22px] inline-block" />}
            <span className="team-name">{m.home}</span>
          </div>
          <div className="team-row">
            {m.away_logo ? <img src={m.away_logo} alt="" loading="lazy" /> : <span className="w-[22px] h-[22px] inline-block" />}
            <span className="team-name">{m.away}</span>
          </div>
        </div>
        {(m.home_score !== "" || m.away_score !== "") && (
          <div className="text-center min-w-[40px]">
            <div className="text-white font-bold text-lg leading-tight">{m.home_score}</div>
            <div className="text-white font-bold text-lg leading-tight">{m.away_score}</div>
          </div>
        )}
      </div>
      {m.has_servers && (
        <div className="mt-1 text-[11px] text-emerald-400 font-semibold">
          ▶ {m.server_count} serveur{m.server_count > 1 ? "s" : ""}
        </div>
      )}
    </button>
  );
}

// ===================== Informations tab (tv247.us) =====================
function InfoTab() {
  const [data, setData] = useState({ days: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await axios.get(`${API}/sports/info`);
        if (!cancelled) setData(r.data);
      } catch (e) {
        console.error(e);
        if (!cancelled) toast.error("Informations indisponibles");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filteredDays = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.days;
    return (data.days || []).map((d) => ({
      ...d,
      events: d.events.filter((e) =>
        (e.event || "").toLowerCase().includes(q) ||
        (e.channels || []).some((c) => (c.channel_name || "").toLowerCase().includes(q))
      ),
    })).filter((d) => d.events.length > 0);
  }, [data.days, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="info-loading">
        <Loader2 className="animate-spin text-blue-400" size={32} />
        <span className="ml-3 text-white/60">Chargement du planning…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="info-content">
      <div className="glass rounded-2xl p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-1">
          <InfoIcon size={16} className="text-blue-400" />
          <div className="text-white font-extrabold">Planning du jour</div>
        </div>
        <div className="text-xs text-white/55">
          Programme des événements et chaînes (source tv247.us, données issues de DaddyLive).
          Cliquez sur une chaîne pour lancer le direct.
        </div>
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
        <input
          data-testid="info-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un événement ou une chaîne…"
          className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-blue-500/50"
        />
      </div>

      {filteredDays.length === 0 ? (
        <div className="glass rounded-2xl p-10 text-center">
          <div className="text-white/80 font-semibold">Aucun événement</div>
        </div>
      ) : (
        filteredDays.map((day, di) => (
          <div key={`day-${di}`} className="space-y-3">
            <h3 className="text-white font-extrabold text-lg flex items-center gap-2">
              <Calendar size={16} className="text-blue-400" /> {day.day}
            </h3>
            <div className="space-y-2">
              {day.events.map((ev, ei) => (
                <div key={`ev-${di}-${ei}`} className="glass rounded-xl p-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-3">
                  <div className="text-blue-300 font-bold text-sm shrink-0 w-16">{ev.time}</div>
                  <div className="flex-1 text-white/90 text-sm">{ev.event}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(ev.channels || []).map((c) => (
                      <Link
                        key={`${c.channel_id}-${c.channel_name}`}
                        to={`/daddy?ch=${c.channel_id}`}
                        className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 border border-white/10 hover:border-[#ff8a00]/40 hover:text-white text-white/70 transition-all"
                        data-testid={`info-ch-${c.channel_id}`}
                      >
                        <Radio size={10} /> {c.channel_name}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
