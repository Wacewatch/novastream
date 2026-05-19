import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Loader2, Flame, Search } from "lucide-react";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Football Live tab (RapidAPI). When a match is selected, calls
 * onPickMatch(match) — the parent fetches the list of servers and shows
 * the AdUnlockModal once, then opens the VideoPlayer with an inline
 * server selector so switching servers does NOT replay the ad.
 */
export default function FootballTab({ onPickMatch }) {
  const [data, setData] = useState({ matches: [], leagues: [] });
  const [loading, setLoading] = useState(true);
  const [league, setLeague] = useState("");
  const [search, setSearch] = useState("");

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
            {liveMatches.map((m) => <FootballCard key={`live-${m.id}`} m={m} onClick={() => onPickMatch?.(m)} />)}
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
            {upcoming.map((m) => <FootballCard key={m.id} m={m} onClick={() => onPickMatch?.(m)} />)}
          </div>
        )}
      </section>
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
