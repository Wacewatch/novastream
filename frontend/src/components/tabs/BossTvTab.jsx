import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Loader2, Search, Tv2 } from "lucide-react";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * BossTV tab — football matches via api.bosstvmm.com. Same UX as Football
 * Live: pick a match → AdUnlockModal → VideoPlayer with inline server
 * selector (no ad replay on server switch).
 */
export default function BossTvTab({ onPickMatch }) {
  const [data, setData] = useState({ matches: [], leagues: [] });
  const [loading, setLoading] = useState(true);
  const [league, setLeague] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all | live | upcoming | finished

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await axios.get(`${API}/bosstv/matches`);
        if (!cancelled) setData(r.data);
      } catch (e) {
        console.error(e);
        if (!cancelled) toast.error("BossTV indisponible");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    // Auto-refresh every 60s (server-side cache is also 60s)
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data.matches || []).filter((m) => {
      if (league && m.league !== league) return false;
      if (statusFilter === "live" && !m.is_live) return false;
      if (statusFilter === "finished" && !m.is_finished) return false;
      if (statusFilter === "upcoming" && (m.is_live || m.is_finished)) return false;
      if (q && !((m.home || "").toLowerCase().includes(q)
        || (m.away || "").toLowerCase().includes(q)
        || (m.league || "").toLowerCase().includes(q)
        || (m.title || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [data.matches, league, search, statusFilter]);

  const liveMatches = filtered.filter((m) => m.is_live);
  const upcoming = filtered.filter((m) => !m.is_live && !m.is_finished);
  const finished = filtered.filter((m) => m.is_finished);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="bosstv-loading">
        <Loader2 className="animate-spin text-fuchsia-400" size={32} />
        <span className="ml-3 text-white/60">Chargement BossTV…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="bosstv-content">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setStatusFilter("all")}
          className={`tab-pill ${statusFilter === "all" ? "is-active" : ""}`}
        >
          Tous ({data.total || 0})
        </button>
        <button
          onClick={() => setStatusFilter("live")}
          className={`tab-pill ${statusFilter === "live" ? "is-active" : ""}`}
        >
          <span className="inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> LIVE ({data.live_count || 0})
          </span>
        </button>
        <button
          onClick={() => setStatusFilter("upcoming")}
          className={`tab-pill ${statusFilter === "upcoming" ? "is-active" : ""}`}
        >
          À venir ({data.upcoming_count || 0})
        </button>
        <button
          onClick={() => setStatusFilter("finished")}
          className={`tab-pill ${statusFilter === "finished" ? "is-active" : ""}`}
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
          data-testid="bosstv-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher une équipe, une ligue…"
          className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-fuchsia-500/50"
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
            {liveMatches.map((m) => <BossCard key={`live-${m.id}`} m={m} onClick={() => onPickMatch?.(m)} />)}
          </div>
        </section>
      )}

      {(statusFilter === "all" || statusFilter === "upcoming") && upcoming.length > 0 && (
        <section>
          <h3 className="text-white font-extrabold mb-3 flex items-center gap-2">
            <Tv2 size={16} className="text-fuchsia-400" /> À venir ({upcoming.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {upcoming.map((m) => <BossCard key={m.id} m={m} onClick={() => onPickMatch?.(m)} />)}
          </div>
        </section>
      )}

      {(statusFilter === "all" || statusFilter === "finished") && finished.length > 0 && (
        <section>
          <h3 className="text-white/70 font-extrabold mb-3 flex items-center gap-2">
            Terminés ({finished.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {finished.map((m) => <BossCard key={m.id} m={m} onClick={() => onPickMatch?.(m)} faded />)}
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

function BossCard({ m, onClick, faded }) {
  return (
    <button
      onClick={onClick}
      className={`match-card ${m.is_live ? "live" : ""}`}
      style={faded ? { opacity: 0.6 } : undefined}
      data-testid={`boss-card-${m.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="league-tag">
          {m.is_live ? "LIVE" : m.is_finished ? "FIN" : (m.league || "BossTV")}
        </span>
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
      </div>
      {m.has_servers && (
        <div className="mt-1 text-[11px] text-emerald-400 font-semibold">
          ▶ {m.server_count} serveur{m.server_count > 1 ? "s" : ""}
        </div>
      )}
      {!m.has_servers && m.is_finished && (
        <div className="mt-1 text-[11px] text-white/40">Terminé</div>
      )}
    </button>
  );
}
