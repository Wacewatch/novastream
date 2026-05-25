import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import axios from "axios";
import {
  Search, Tv2, Heart, Users, Code2, Grid3x3, Shield, Crown, ArrowLeft,
  LayoutDashboard, Sparkles,
} from "lucide-react";
import UserMenu from "@/components/UserMenu";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || window.location.origin;
const API = `${BACKEND_URL}/api`;
const LOGO = "https://i.imgur.com/V8YmT4z.png";

/**
 * Shared, modern top bar used across every page of the app.
 *
 * Props:
 *   variant: "tv" | "daddy" | "sports" | "multiview" | "docs" | "admin" | "dashboard" | "minimal"
 *     Drives the accent color stripe and which controls are exposed.
 *   showSearch: bool (defaults to true on "tv" only)
 *   search / onSearchChange: controlled search input (only used when showSearch)
 *   onlyFavorites / onToggleFavorites / favoritesCount: favourites pill
 *   right: optional extra controls inserted right before UserMenu
 *   sublabel: optional label shown next to the logo (e.g. "Admin", "Multiview")
 *   backTo: optional path — when provided a back button is rendered instead of the logo
 */
const VARIANT_ACCENT = {
  tv:        { color: "#ff2e63", label: "TV" },
  daddy:     { color: "#ff8a00", label: "DaddyTV" },
  sports:    { color: "#10b981", label: "Sports" },
  football:  { color: "#ef4444", label: "Football" },
  bosstv:    { color: "#d946ef", label: "BossTV" },
  multiview: { color: "#6366f1", label: "Multiview" },
  docs:      { color: "#06b6d4", label: "API" },
  admin:     { color: "#8b5cf6", label: "Admin" },
  dashboard: { color: "#22d3ee", label: "Dashboard" },
  minimal:   { color: "#ff2e63", label: "" },
};

export default function TopBar({
  variant = "tv",
  showSearch = false,
  search = "",
  onSearchChange = null,
  onlyFavorites = false,
  onToggleFavorites = null,
  favoritesCount = 0,
  stats = null,            // { total_24h, live_total }
  right = null,
  sublabel = "",
  backTo = null,
}) {
  const location = useLocation();
  const cfg = VARIANT_ACCENT[variant] || VARIANT_ACCENT.minimal;
  const accent = cfg.color;
  const label = sublabel || cfg.label;

  const showMulti  = variant !== "multiview";
  const showFavs   = onToggleFavorites != null;
  const showStats  = stats && (stats.total_24h || stats.live_total);
  const showApi    = variant !== "docs";

  return (
    <header
      className="topbar-root"
      data-testid={`topbar-${variant}`}
      style={{ "--accent": accent }}
    >
      <div className="topbar-accent" />
      <div className="topbar-inner">
        {backTo ? (
          <Link to={backTo} className="topbar-back" aria-label="Retour" data-testid="topbar-back">
            <ArrowLeft size={18} />
          </Link>
        ) : null}

        <Link to="/" className="topbar-brand shrink-0" data-testid="brand-logo">
          <img src={LOGO} alt="LiveWatch" className="topbar-logo" draggable={false} />
          {label ? (
            <span className="topbar-sublabel">
              {variant === "admin"     && <Shield     size={11} />}
              {variant === "dashboard" && <Sparkles   size={11} />}
              {variant === "multiview" && <Grid3x3    size={11} />}
              {variant === "docs"      && <Code2      size={11} />}
              {variant === "daddy"     && <Tv2        size={11} />}
              {variant === "sports"    && <Crown      size={11} />}
              {label}
            </span>
          ) : null}
        </Link>

        {showSearch && (
          <div className="topbar-search hidden md:flex">
            <Search size={16} className="topbar-search-icon" />
            <input
              value={search}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder="Rechercher une chaîne…"
              data-testid="search-input"
              className="topbar-search-input"
            />
            {search ? (
              <button
                onClick={() => onSearchChange?.("")}
                className="topbar-search-clear"
                aria-label="Effacer"
              >×</button>
            ) : null}
          </div>
        )}

        <div className="topbar-actions">
          {showStats ? (
            <div className="topbar-stat hidden lg:flex" data-testid="topbar-stat-24h" title="Vues uniques sur les dernières 24h">
              <Users size={13} />
              <span className="topbar-stat-value">{(stats.total_24h || 0).toLocaleString("fr-FR")}</span>
              <span className="topbar-stat-label">/ 24h</span>
            </div>
          ) : null}

          {showStats && stats.live_total > 0 ? (
            <div className="topbar-stat hidden sm:flex topbar-stat-live" title="Spectateurs en direct">
              <span className="topbar-live-dot" />
              <span className="topbar-stat-value">{stats.live_total}</span>
              <span className="topbar-stat-label">live</span>
            </div>
          ) : null}

          {showFavs ? (
            <button
              onClick={onToggleFavorites}
              className={`topbar-pill hidden sm:inline-flex ${onlyFavorites ? "is-active" : ""}`}
              data-testid="favorites-filter-btn"
              title={onlyFavorites ? "Afficher tout" : "Afficher mes favoris"}
            >
              <Heart
                size={13}
                fill={onlyFavorites ? "var(--accent)" : "transparent"}
                color={onlyFavorites ? "var(--accent)" : "currentColor"}
                strokeWidth={onlyFavorites ? 0 : 2}
              />
              <span className="text-xs font-semibold tabular-nums">{favoritesCount}</span>
            </button>
          ) : null}

          {showMulti ? (
            <Link
              to="/multiview"
              className={`topbar-pill hidden sm:inline-flex ${location.pathname.startsWith("/multiview") ? "is-active" : ""}`}
              data-testid="multiview-link"
              title="Mode multiview"
            >
              <Grid3x3 size={13} />
              <span className="text-xs">Multi</span>
            </Link>
          ) : null}

          {showApi ? (
            <Link
              to="/docs"
              className={`topbar-pill hidden sm:inline-flex ${location.pathname.startsWith("/docs") ? "is-active" : ""}`}
              data-testid="api-link"
              title="Documentation API"
            >
              <Code2 size={13} />
              <span className="text-xs">API</span>
            </Link>
          ) : null}

          {right}

          <UserMenu />
        </div>
      </div>

      {showSearch && (
        <div className="topbar-search-mobile md:hidden">
          <Search size={16} className="topbar-search-icon" />
          <input
            value={search}
            onChange={(e) => onSearchChange?.(e.target.value)}
            placeholder="Rechercher une chaîne…"
            data-testid="search-input-mobile"
            className="topbar-search-input"
          />
          {search ? (
            <button onClick={() => onSearchChange?.("")} className="topbar-search-clear" aria-label="Effacer">×</button>
          ) : null}
        </div>
      )}
    </header>
  );
}

/**
 * Tiny EPG-now display used by VideoPlayer top bar. Self-contained so it can
 * be dropped in any player without prop drilling.
 */
export function EpgNowBadge({ channelName, refreshMs = 60000, onLoaded = null }) {
  const [data, setData] = useState(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!channelName) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await axios.get(`${API}/epg/now`, { params: { name: channelName }, timeout: 10000 });
        if (cancelled) return;
        setData(r.data || null);
        onLoaded?.(r.data);
      } catch (_e) {
        if (!cancelled) setData(null);
      }
    };
    load();
    const id = setInterval(load, refreshMs);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, refreshMs]);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15000);
    return () => clearInterval(t);
  }, []);

  if (!data || !data.current) return null;
  const cur = data.current;
  const nxt = data.next;
  const liveProgress = Math.max(0, Math.min(1, (now - cur.start) / Math.max(1, cur.stop - cur.start)));
  const remaining = Math.max(0, cur.stop - now);
  const fmt = (s) => {
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
  };
  const fmtTime = (ts) => {
    try {
      return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch { return ""; }
  };

  return (
    <div className="epg-now" data-testid="epg-now">
      <div className="epg-now-current">
        <span className="epg-now-time">{fmtTime(cur.start)}</span>
        <span className="epg-now-title" title={cur.desc || cur.title}>{cur.title}</span>
        {cur.category ? <span className="epg-now-cat">{cur.category}</span> : null}
      </div>
      <div className="epg-now-bar">
        <div className="epg-now-bar-fill" style={{ width: `${liveProgress * 100}%` }} />
      </div>
      <div className="epg-now-meta">
        <span>{fmt(remaining)} restant</span>
        {nxt ? (
          <span className="epg-now-next" title={nxt.desc || nxt.title}>
            <span className="epg-now-next-arrow">›</span>
            <span className="epg-now-next-time">{fmtTime(nxt.start)}</span>
            <span className="epg-now-next-title">{nxt.title}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
