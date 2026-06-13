import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Loader2, Search, Radio, Flame } from "lucide-react";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Jack07 TV tab — multi-sport live & upcoming matches scraped from Jack07.
 * Sports tabs (Football, Basketball, Tennis, …) are fetched dynamically
 * from /api/jack07/sports. Each match card surfaces a SPORT badge so the
 * user always knows what they're watching.
 */
export default function Jack07TvTab({ onPickMatch }) {
  const [sports, setSports] = useState([]);
  const [sportType, setSportType] = useState(1);
  const [data, setData] = useState({ matches: [], leagues: [] });
  const [streamCounts, setStreamCounts] = useState({}); // { [matchId]: count }
  const [loading, setLoading] = useState(true);
  const [league, setLeague] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Load the list of sports once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API}/jack07/sports`);
        if (!cancelled) setSports(r.data?.sports || []);
      } catch {
        if (!cancelled) setSports([{ id: 1, label: "Football", slug: "football" }]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load matches whenever the sport changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLeague("");
    setStreamCounts({});
    const load = async () => {
      try {
        const r = await axios.get(`${API}/jack07/matches`, { params: { sport: sportType } });
        if (!cancelled) setData(r.data);
      } catch (e) {
        console.error(e);
        if (!cancelled) toast.error("Jack07 TV indisponible");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [sportType]);

  // Fetch source counts for LIVE matches (capped at 30 ids per request).
  useEffect(() => {
    const liveIds = (data.matches || []).filter((m) => m.is_live).map((m) => m.id).slice(0, 30);
    if (!liveIds.length) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API}/jack07/stream-counts`, {
          params: { sport: sportType, ids: liveIds.join(",") },
        });
        if (!cancelled) setStreamCounts((prev) => ({ ...prev, ...(r.data?.counts || {}) }));
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [data.matches, sportType]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data.matches || []).filter((m) => {
      const leagueName = m.league?.name || "";
      if (league && leagueName !== league) return false;
      if (statusFilter === "live" && !m.is_live) return false;
      if (statusFilter === "finished" && !m.is_finished) return false;
      if (statusFilter === "upcoming" && (m.is_live || m.is_finished)) return false;
      if (q) {
        const hay = `${m.home?.name || ""} ${m.away?.name || ""} ${leagueName} ${m.title || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data.matches, league, search, statusFilter]);

  const liveMatches = filtered.filter((m) => m.is_live);
  const upcoming = filtered.filter((m) => !m.is_live && !m.is_finished);
  const finished = filtered.filter((m) => m.is_finished);

  return (
    <div className="space-y-6" data-testid="jack07-content">
      {/* ===== Sport selector ===== */}
      {sports.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap" data-testid="jack07-sports">
          {sports.map((s) => (
            <button
              key={s.id}
              onClick={() => setSportType(s.id)}
              className={`tab-pill ${sportType === s.id ? "is-active" : ""}`}
              data-testid={`jack07-sport-${s.slug}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20" data-testid="jack07-loading">
          <Loader2 className="animate-spin text-amber-400" size={32} />
          <span className="ml-3 text-white/60">Chargement Jack07 TV…</span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setStatusFilter("all")}
              className={`tab-pill ${statusFilter === "all" ? "is-active" : ""}`}
              data-testid="jack07-filter-all"
            >
              Tous ({data.total || 0})
            </button>
            <button
              onClick={() => setStatusFilter("live")}
              className={`tab-pill ${statusFilter === "live" ? "is-active" : ""}`}
              data-testid="jack07-filter-live"
            >
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> LIVE ({data.live_count || 0})
              </span>
            </button>
            <button
              onClick={() => setStatusFilter("upcoming")}
              className={`tab-pill ${statusFilter === "upcoming" ? "is-active" : ""}`}
              data-testid="jack07-filter-upcoming"
            >
              À venir ({data.upcoming_count || 0})
            </button>
            <button
              onClick={() => setStatusFilter("finished")}
              className={`tab-pill ${statusFilter === "finished" ? "is-active" : ""}`}
              data-testid="jack07-filter-finished"
            >
              Terminés ({data.finished_count || 0})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setLeague("")}
              className={`tab-pill ${!league ? "is-active" : ""}`}
            >
              Toutes ligues
            </button>
            {(data.leagues || []).slice(0, 20).map((l) => (
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
              data-testid="jack07-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une équipe, une ligue…"
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-amber-500/50"
            />
          </div>

          {liveMatches.length > 0 && (
            <section>
              <h3 className="text-white font-extrabold mb-3 flex items-center gap-2">
                <Flame size={16} className="text-red-400" />
                <span className="inline-flex items-center gap-1 text-red-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> LIVE
                </span>
                ({liveMatches.length})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {liveMatches.map((m) => <Jack07Card key={`live-${m.id}`} m={m} sourcesCount={streamCounts[m.id]} onClick={() => onPickMatch?.(m)} />)}
              </div>
            </section>
          )}

          {(statusFilter === "all" || statusFilter === "upcoming") && upcoming.length > 0 && (
            <section>
              <h3 className="text-white font-extrabold mb-3 flex items-center gap-2">
                <Radio size={16} className="text-amber-400" /> À venir ({upcoming.length})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {upcoming.map((m) => <Jack07Card key={m.id} m={m} onClick={() => onPickMatch?.(m)} />)}
              </div>
            </section>
          )}

          {(statusFilter === "all" || statusFilter === "finished") && finished.length > 0 && (
            <section>
              <h3 className="text-white/70 font-extrabold mb-3">Terminés ({finished.length})</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {finished.map((m) => <Jack07Card key={m.id} m={m} onClick={() => onPickMatch?.(m)} faded />)}
              </div>
            </section>
          )}

          {filtered.length === 0 && (
            <div className="glass rounded-2xl p-10 text-center">
              <div className="text-white/80 font-semibold">Aucun match trouvé</div>
              <div className="text-white/50 text-sm mt-1">Essayez un autre sport, filtre ou recherche.</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function fmtTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function Jack07Card({ m, onClick, faded, sourcesCount }) {
  const score = (m.home_score != null && m.away_score != null) ? `${m.home_score} - ${m.away_score}` : null;
  // For live matches show the actual source count once known; for upcoming
  // matches we don't pre-fetch — show a generic CTA.
  let sourcesLabel;
  if (typeof sourcesCount === "number") {
    sourcesLabel = sourcesCount > 0
      ? `▶ ${sourcesCount} source${sourcesCount > 1 ? "s" : ""} disponible${sourcesCount > 1 ? "s" : ""}`
      : "✕ Aucune source pour le moment";
  } else {
    sourcesLabel = m.is_live ? "▶ Recherche des sources…" : "▶ Sources au coup d'envoi";
  }
  const sourcesColor = typeof sourcesCount === "number" && sourcesCount === 0
    ? "text-white/40"
    : "text-amber-400";
  return (
    <button
      onClick={onClick}
      className={`match-card ${m.is_live ? "live" : ""}`}
      style={faded ? { opacity: 0.6 } : undefined}
      data-testid={`jack07-card-${m.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {m.sport && (
            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold uppercase tracking-wide whitespace-nowrap" data-testid={`jack07-card-sport-${m.id}`}>
              {m.sport}
            </span>
          )}
          <span className="league-tag truncate">
            {m.is_live ? (m.status_label || "LIVE") : m.is_finished ? "FIN" : (m.league?.name || "Jack07")}
          </span>
        </div>
        <span className="text-[11px] text-white/55 whitespace-nowrap">{m.is_live ? (m.status_label || "LIVE") : fmtTime(m.kick_off_iso)}</span>
      </div>
      <div className="flex items-center gap-3 mt-2">
        <div className="flex-1 flex flex-col gap-1">
          <div className="team-row">
            {m.home?.logo ? <img src={m.home.logo} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = "hidden")} /> : <span className="w-[22px] h-[22px] inline-block" />}
            <span className="team-name">{m.home?.name || "—"}</span>
            {score && <span className="ml-auto text-white font-bold tabular-nums">{m.home_score}</span>}
          </div>
          <div className="team-row">
            {m.away?.logo ? <img src={m.away.logo} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = "hidden")} /> : <span className="w-[22px] h-[22px] inline-block" />}
            <span className="team-name">{m.away?.name || "—"}</span>
            {score && <span className="ml-auto text-white font-bold tabular-nums">{m.away_score}</span>}
          </div>
        </div>
      </div>
      <div className={`mt-1 text-[11px] font-semibold ${sourcesColor}`} data-testid={`jack07-card-sources-${m.id}`}>
        {sourcesLabel}
      </div>
    </button>
  );
}
