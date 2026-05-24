import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Activity, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || window.location.origin;
const API = `${BACKEND_URL}/api`;

const todayIso = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const shiftDate = (iso, delta) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
};

const prettyDate = (iso) => {
  try {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" });
  } catch { return iso; }
};

export default function SportsTicker({ refreshMs = 60000 }) {
  const [date, setDate] = useState(todayIso());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all"); // all | live | upcoming | finished
  const trackRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const r = await axios.get(`${API}/sports/daily`, { params: { date }, timeout: 15000 });
        if (cancelled) return;
        setData(r.data || { matches: [] });
      } catch (_e) {
        if (!cancelled) setData({ matches: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, refreshMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [date, refreshMs]);

  const matches = useMemo(() => {
    const all = data?.matches || [];
    if (filter === "live") return all.filter((m) => m.is_live);
    if (filter === "upcoming") return all.filter((m) => !m.is_live && !m.is_finished);
    if (filter === "finished") return all.filter((m) => m.is_finished);
    return all;
  }, [data, filter]);

  const stats = {
    total: data?.total || 0,
    live: data?.live_count || 0,
    finished: data?.finished_count || 0,
    upcoming: data?.upcoming_count || 0,
  };

  const scroll = (delta) => {
    const el = trackRef.current;
    if (el) el.scrollBy({ left: delta, behavior: "smooth" });
  };

  return (
    <section className="sports-ticker" data-testid="sports-ticker">
      <div className="sports-ticker-head">
        <div className="sports-ticker-title">
          <Activity size={15} className="text-emerald-400" />
          <span>Matchs du jour</span>
          {loading ? (
            <RefreshCw size={12} className="ml-1 animate-spin text-white/40" />
          ) : null}
        </div>

        <div className="sports-ticker-date">
          <button
            className="sports-ticker-nav"
            onClick={() => setDate((d) => shiftDate(d, -1))}
            aria-label="Jour précédent"
            data-testid="ticker-prev-day"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            className="sports-ticker-day"
            onClick={() => setDate(todayIso())}
            data-testid="ticker-today"
            title="Revenir à aujourd'hui"
          >
            {prettyDate(date)}
          </button>
          <button
            className="sports-ticker-nav"
            onClick={() => setDate((d) => shiftDate(d, 1))}
            aria-label="Jour suivant"
            data-testid="ticker-next-day"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        <div className="sports-ticker-filters">
          {[
            { key: "all",      label: "Tous",     count: stats.total },
            { key: "live",     label: "Live",     count: stats.live, hot: true },
            { key: "upcoming", label: "À venir",  count: stats.upcoming },
            { key: "finished", label: "Terminés", count: stats.finished },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`sports-ticker-filter ${filter === f.key ? "is-active" : ""} ${f.hot && f.count > 0 ? "is-hot" : ""}`}
              data-testid={`ticker-filter-${f.key}`}
            >
              {f.label}
              <span className="sports-ticker-filter-count">{f.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="sports-ticker-body">
        <button
          className="sports-ticker-arrow left"
          onClick={() => scroll(-360)}
          aria-label="Défiler à gauche"
        >
          <ChevronLeft size={16} />
        </button>

        <div className="sports-ticker-track" ref={trackRef} data-testid="ticker-track">
          {matches.length === 0 && !loading ? (
            <div className="sports-ticker-empty">Aucun match {filter === "live" ? "en direct" : ""} pour {prettyDate(date)}.</div>
          ) : (
            matches.map((m) => <TickerCard key={m.id} m={m} />)
          )}
        </div>

        <button
          className="sports-ticker-arrow right"
          onClick={() => scroll(360)}
          aria-label="Défiler à droite"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </section>
  );
}

function TickerCard({ m }) {
  const isLive = m.is_live;
  const isFinished = m.is_finished;
  const statusClass = isLive ? "live" : isFinished ? "finished" : "upcoming";
  const showScore = m.home_goals != null && m.away_goals != null;

  return (
    <div className={`sports-ticker-card ${statusClass}`} data-testid={`ticker-match-${m.id}`}>
      <div className="sports-ticker-card-top">
        <span className="sports-ticker-card-league" title={m.league}>{m.league}</span>
        <span className={`sports-ticker-card-status ${statusClass}`}>
          {isLive && <span className="sports-ticker-live-dot" />}
          {isLive ? (m.status_label || "LIVE") : isFinished ? "Terminé" : (m.kick_off_label || "—")}
        </span>
      </div>

      <div className="sports-ticker-card-teams">
        <div className="sports-ticker-team">
          {m.home_logo ? (
            <img src={m.home_logo} alt="" className="sports-ticker-team-logo" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
          ) : (
            <span className="sports-ticker-team-placeholder" />
          )}
          <span className="sports-ticker-team-name" title={m.home_name}>{m.home_name}</span>
          {showScore ? <span className={`sports-ticker-score ${m.home_goals > m.away_goals ? "win" : ""}`}>{m.home_goals}</span> : null}
        </div>
        <div className="sports-ticker-team">
          {m.away_logo ? (
            <img src={m.away_logo} alt="" className="sports-ticker-team-logo" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
          ) : (
            <span className="sports-ticker-team-placeholder" />
          )}
          <span className="sports-ticker-team-name" title={m.away_name}>{m.away_name}</span>
          {showScore ? <span className={`sports-ticker-score ${m.away_goals > m.home_goals ? "win" : ""}`}>{m.away_goals}</span> : null}
        </div>
      </div>
    </div>
  );
}
