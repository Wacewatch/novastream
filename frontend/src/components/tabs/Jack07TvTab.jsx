import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Loader2, Search, Radio, Flame } from "lucide-react";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Jack07 TV tab — football matches scraped from Jack07. Same UX as BossTV:
 * pick a match → AdUnlockModal → Jack07Overlay (iframe + match info below).
 * The upstream Jack07 site is iframed (it allows framing) and exposes a
 * server picker inside the page (FIFA US, Canal FR, DAZN ES, …) so we
 * don't need a server selector on our side.
 */
export default function Jack07TvTab({ onPickMatch }) {
  const [data, setData] = useState({ matches: [], leagues: [] });
  const [loading, setLoading] = useState(true);
  const [league, setLeague] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await axios.get(`${API}/jack07/matches`);
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
  }, []);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="jack07-loading">
        <Loader2 className="animate-spin text-amber-400" size={32} />
        <span className="ml-3 text-white/60">Chargement Jack07 TV…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="jack07-content">
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
            {liveMatches.map((m) => <Jack07Card key={`live-${m.id}`} m={m} onClick={() => onPickMatch?.(m)} />)}
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
          <div className="text-white/50 text-sm mt-1">Essayez de modifier le filtre ou la recherche.</div>
        </div>
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

function Jack07Card({ m, onClick, faded }) {
  const score = (m.home_score != null && m.away_score != null) ? `${m.home_score} - ${m.away_score}` : null;
  return (
    <button
      onClick={onClick}
      className={`match-card ${m.is_live ? "live" : ""}`}
      style={faded ? { opacity: 0.6 } : undefined}
      data-testid={`jack07-card-${m.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="league-tag">
          {m.is_live ? (m.status_label || "LIVE") : m.is_finished ? "FIN" : (m.league?.name || "Jack07")}
        </span>
        <span className="text-[11px] text-white/55">{m.is_live ? (m.status_label || "LIVE") : fmtTime(m.kick_off_iso)}</span>
      </div>
      <div className="flex items-center gap-3 mt-2">
        <div className="flex-1 flex flex-col gap-1">
          <div className="team-row">
            {m.home?.logo ? <img src={m.home.logo} alt="" loading="lazy" /> : <span className="w-[22px] h-[22px] inline-block" />}
            <span className="team-name">{m.home?.name || "—"}</span>
            {score && <span className="ml-auto text-white font-bold tabular-nums">{m.home_score}</span>}
          </div>
          <div className="team-row">
            {m.away?.logo ? <img src={m.away.logo} alt="" loading="lazy" /> : <span className="w-[22px] h-[22px] inline-block" />}
            <span className="team-name">{m.away?.name || "—"}</span>
            {score && <span className="ml-auto text-white font-bold tabular-nums">{m.away_score}</span>}
          </div>
        </div>
      </div>
      <div className="mt-1 text-[11px] text-amber-400 font-semibold">
        ▶ Sources multi-serveurs
      </div>
    </button>
  );
}
