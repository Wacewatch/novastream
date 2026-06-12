import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { X, Maximize, Minimize, RotateCcw, Activity, BarChart3 } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Jack07 TV playback overlay.
 *
 * Layout (per user spec):
 *   ┌──────────────────────────────────────────┐
 *   │       Iframe player (site_url)           │   ← 16/9 player
 *   ├──────────────────────────────────────────┤
 *   │  Match info: live score, events, stats   │   ← below player
 *   └──────────────────────────────────────────┘
 *
 * Events + stats poll every 15 s while the overlay is open.
 */
export default function Jack07Overlay({ match, detail, onClose }) {
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState([]);
  const [fs, setFs] = useState(false);
  const iframeRef = useRef(null);

  const matchId = match?.id || detail?.id;
  const siteUrl = detail?.site_url || match?.site_url || "";

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [e, s] = await Promise.all([
          axios.get(`${API}/jack07/events/${matchId}`),
          axios.get(`${API}/jack07/stats/${matchId}`),
        ]);
        if (cancelled) return;
        setEvents(e.data?.events || []);
        setStats(s.data?.stats || []);
      } catch (_e) { /* silent */ }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [matchId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const reload = () => {
    const ifr = iframeRef.current;
    if (!ifr || !siteUrl) return;
    const u = siteUrl.split("#")[0];
    ifr.src = u + (u.includes("?") ? "&" : "?") + "_t=" + Date.now();
  };

  const toggleFs = () => {
    const ifr = iframeRef.current;
    if (!ifr) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      setFs(false);
    } else if (ifr.requestFullscreen) {
      ifr.requestFullscreen().then(() => setFs(true)).catch(() => setFs(true));
    } else {
      setFs((v) => !v);
    }
  };

  const homeName = detail?.home?.name || match?.home?.name || "";
  const awayName = detail?.away?.name || match?.away?.name || "";
  const homeLogo = detail?.home?.logo || match?.home?.logo || "";
  const awayLogo = detail?.away?.logo || match?.away?.logo || "";
  const hs = (detail?.home_score ?? match?.home_score);
  const as = (detail?.away_score ?? match?.away_score);
  const statusLabel = detail?.status_label || match?.status_label || "";
  const leagueName = detail?.league?.name || match?.league?.name || "";

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/90 backdrop-blur-md overflow-y-auto"
      data-testid="jack07-overlay"
    >
      <div className="min-h-full flex flex-col">
        {/* ===== Top bar ===== */}
        <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-black/60 backdrop-blur border-b border-white/10">
          <div className="min-w-0 flex-1">
            <div className="text-white font-extrabold text-sm truncate">{match?.title || `${homeName} vs ${awayName}`}</div>
            <div className="text-white/55 text-[11px] truncate">
              {leagueName}{statusLabel ? ` · ${statusLabel}` : ""}
            </div>
          </div>
          <button onClick={reload} className="iframe-player-btn" title="Recharger" data-testid="jack07-reload">
            <RotateCcw size={15} />
          </button>
          <button onClick={toggleFs} className="iframe-player-btn" title="Plein écran" data-testid="jack07-fs">
            {fs ? <Minimize size={15} /> : <Maximize size={15} />}
          </button>
          <button onClick={onClose} className="iframe-player-btn iframe-player-btn-close" title="Fermer" data-testid="jack07-close">
            <X size={16} />
          </button>
        </div>

        {/* ===== Player ===== */}
        <div className="px-4 pt-4">
          <div className="mx-auto max-w-5xl">
            <div className="relative w-full rounded-2xl overflow-hidden bg-black border border-white/10" style={{ aspectRatio: "16 / 9" }}>
              {siteUrl ? (
                <iframe
                  ref={iframeRef}
                  src={siteUrl}
                  title="Jack07 TV"
                  className="absolute inset-0 w-full h-full"
                  allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                  allowFullScreen
                  referrerPolicy="no-referrer"
                  data-testid="jack07-iframe"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-white/60">
                  Aucun flux disponible pour ce match.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ===== Score banner ===== */}
        {(homeName || awayName) && (
          <div className="px-4 mt-4">
            <div className="mx-auto max-w-5xl glass rounded-2xl p-4 flex items-center justify-around gap-4">
              <div className="flex flex-col items-center gap-2 min-w-0">
                {homeLogo && <img src={homeLogo} alt="" className="w-12 h-12 object-contain" />}
                <span className="text-white font-bold text-sm text-center truncate max-w-[140px]">{homeName}</span>
              </div>
              <div className="flex flex-col items-center">
                <div className="text-3xl font-black text-white tabular-nums">
                  {hs != null && as != null ? `${hs} - ${as}` : "VS"}
                </div>
                {statusLabel && (
                  <div className="text-[11px] text-red-400 font-bold tracking-wide mt-1">{statusLabel}</div>
                )}
              </div>
              <div className="flex flex-col items-center gap-2 min-w-0">
                {awayLogo && <img src={awayLogo} alt="" className="w-12 h-12 object-contain" />}
                <span className="text-white font-bold text-sm text-center truncate max-w-[140px]">{awayName}</span>
              </div>
            </div>
          </div>
        )}

        {/* ===== Info: events + stats ===== */}
        <div className="px-4 mt-4 pb-10">
          <div className="mx-auto max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className="glass rounded-2xl p-4" data-testid="jack07-events-panel">
              <h3 className="text-white font-extrabold mb-3 flex items-center gap-2">
                <Activity size={16} className="text-red-400" /> Événements ({events.length})
              </h3>
              {events.length === 0 ? (
                <div className="text-white/50 text-sm">Aucun événement pour le moment.</div>
              ) : (
                <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                  {events.map((ev, i) => <EventRow key={i} ev={ev} />)}
                </ul>
              )}
            </section>
            <section className="glass rounded-2xl p-4" data-testid="jack07-stats-panel">
              <h3 className="text-white font-extrabold mb-3 flex items-center gap-2">
                <BarChart3 size={16} className="text-amber-400" /> Statistiques
              </h3>
              {stats.length === 0 ? (
                <div className="text-white/50 text-sm">Statistiques indisponibles.</div>
              ) : (
                <ul className="space-y-3">
                  {stats.map((s, i) => <StatRow key={i} s={s} />)}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function EventRow({ ev }) {
  const sideColor = ev.side === "home" ? "border-l-emerald-400" : ev.side === "away" ? "border-l-sky-400" : "border-l-white/30";
  const iconBg = ev.kind === 110 ? "bg-yellow-400" : ev.kind === 111 || ev.kind === 112 ? "bg-red-500" : ev.kind === 101 || ev.kind === 102 ? "bg-emerald-500" : "bg-white/20";
  return (
    <li className={`flex items-center gap-3 pl-3 py-1.5 border-l-2 ${sideColor}`}>
      <span className="text-white/80 font-bold text-sm w-10 text-right tabular-nums">{ev.minute || "—"}&apos;</span>
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${iconBg}`} />
      <span className="text-white text-sm flex-1 truncate">
        <span className="font-semibold">{ev.label}</span>
        {ev.player ? <span className="text-white/60"> — {ev.player}</span> : null}
      </span>
      {ev.score && <span className="text-white/60 text-xs tabular-nums">{ev.score}</span>}
    </li>
  );
}

function StatRow({ s }) {
  // Compute % bar widths if both numeric
  const h = parseFloat(String(s.home ?? "").replace("%", "")) || 0;
  const a = parseFloat(String(s.away ?? "").replace("%", "")) || 0;
  const total = h + a;
  const hp = total > 0 ? (h / total) * 100 : 50;
  const ap = total > 0 ? (a / total) * 100 : 50;
  return (
    <li>
      <div className="flex items-center justify-between text-xs text-white/80 mb-1">
        <span className="font-semibold tabular-nums">{s.home ?? "—"}</span>
        <span className="text-white/60 truncate px-2 text-center flex-1">{s.label}</span>
        <span className="font-semibold tabular-nums">{s.away ?? "—"}</span>
      </div>
      <div className="flex h-1.5 rounded-full overflow-hidden bg-white/10">
        <div className="bg-emerald-400" style={{ width: `${hp}%` }} />
        <div className="bg-sky-400" style={{ width: `${ap}%` }} />
      </div>
    </li>
  );
}
