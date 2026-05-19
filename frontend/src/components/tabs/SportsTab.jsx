import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Loader2, Trophy, Calendar, Flame, Search } from "lucide-react";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Sports tab (streamed.pk). Parent prop:
 *  - onPickStream({ title, embedUrl, sources, activeSource })
 *    The parent shows AdUnlockModal then renders the IframePlayer with a
 *    "rightSlot" picker that calls onSwitchSource to change server in-place.
 */
export default function SportsTab({ onPickMatch }) {
  const [data, setData] = useState({ events: [], sports: [], sportCounts: {} });
  const [loading, setLoading] = useState(true);
  const [sport, setSport] = useState("");
  const [search, setSearch] = useState("");

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

      {popular.length > 0 && (
        <section data-testid="sports-popular">
          <h3 className="text-white font-extrabold mb-3 flex items-center gap-2">
            <Flame size={16} className="text-orange-400" /> Populaires ({popular.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {popular.map((m) => <MatchCard key={`pop-${m.id}`} m={m} onClick={() => onPickMatch?.(m)} />)}
          </div>
        </section>
      )}

      {live.length > 0 && (
        <section data-testid="sports-live">
          <h3 className="text-white font-extrabold mb-3 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> LIVE
            </span>
            ({live.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {live.map((m) => <MatchCard key={`live-${m.id}`} m={m} onClick={() => onPickMatch?.(m)} />)}
          </div>
        </section>
      )}

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
            {filtered.map((m) => <MatchCard key={m.id} m={m} onClick={() => onPickMatch?.(m)} />)}
          </div>
        )}
      </section>
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

function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
