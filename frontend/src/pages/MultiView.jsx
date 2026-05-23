import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import {
  Search, Globe2, Grid3x3, ArrowLeft, Tv2, Trash2, Loader2,
  X as XIcon, Radio, Trophy, Crown,
} from "lucide-react";
import MultiViewCell from "@/components/MultiViewCell";
import FlagIcon from "@/components/FlagIcon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || window.location.origin;
const API = `${BACKEND_URL}/api`;
const STORAGE_KEY = "livewatch.multiview.v2";

const LAYOUTS = [
  { id: 2, label: "2×2", cells: 4 },
  { id: 3, label: "3×3", cells: 9 },
  { id: 4, label: "4×4", cells: 16 },
];

const SOURCE_TABS = [
  { id: "tv", label: "TV", icon: Tv2, color: "#ff2e63" },
  { id: "daddy", label: "DaddyTV", icon: Radio, color: "#ff8a00" },
  { id: "sports", label: "Sports", icon: Trophy, color: "#10b981" },
  { id: "bosstv", label: "BossTV", icon: Crown, color: "#d946ef" },
];

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) { /* noop */ }
}

// Migrate legacy v1 cells (which had no `kind` field) to v2.
function loadLegacyState() {
  try {
    const raw = localStorage.getItem("livewatch.multiview.v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const cells = (parsed.cells || []).map((c) => (c ? { ...c, kind: c.kind || "tv" } : null));
    return { ...parsed, cells };
  } catch (_) {
    return null;
  }
}

export default function MultiView() {
  const initial = useMemo(() => loadState() || loadLegacyState(), []);
  const [layout, setLayout] = useState(initial?.layout || 2);

  // cells: array of {kind, id, name, country?, src} | null
  // src is the iframe URL the cell renders.
  const [cells, setCells] = useState(() => {
    const init = initial?.cells || [];
    const arr = new Array(16).fill(null);
    for (let i = 0; i < Math.min(16, init.length); i++) {
      const c = init[i];
      if (c && c.id && c.name && c.src) arr[i] = { ...c, kind: c.kind || "tv" };
    }
    return arr;
  });

  // Picker modal
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTargetIndex, setPickerTargetIndex] = useState(-1);
  const [pickerSource, setPickerSource] = useState(initial?.lastSource || "tv");

  // TV-specific filters
  const [countries, setCountries] = useState(["France"]);
  const [country, setCountry] = useState(initial?.lastCountry || "France");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  // Daddy-specific filters
  const [daddyCountries, setDaddyCountries] = useState([]);
  const [daddyCountry, setDaddyCountry] = useState("");

  // Persist state
  useEffect(() => {
    saveState({ layout, cells, lastCountry: country, lastSource: pickerSource });
  }, [layout, cells, country, pickerSource]);

  // Fetch countries once (TV)
  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${API}/countries`);
        const list = r.data.countries || [];
        setCountries(["France", ...list.filter((c) => c !== "France")]);
      } catch (_) { /* noop */ }
    })();
  }, []);

  // Build the iframe src URL based on the source + item.
  const buildSrc = (source, item) => {
    if (source === "tv") return `/embed/${encodeURIComponent(item.id)}`;
    if (source === "daddy") return `/embed/daddy/${encodeURIComponent(item.id)}`;
    if (source === "sports") {
      const first = (item.sources || [])[0];
      if (!first) return "";
      const t = encodeURIComponent(item.title || item.name || "Match");
      return `/embed/sports/${encodeURIComponent(first.source)}/${encodeURIComponent(first.id)}?t=${t}`;
    }
    if (source === "bosstv") {
      if (!item.has_servers && !item.server_count) return "";
      return `/embed/bosstv/${encodeURIComponent(item.id)}/0`;
    }
    return "";
  };

  // Load list when picker is open + filters change
  useEffect(() => {
    if (!pickerOpen) return;
    const ctrl = new AbortController();
    let cancelled = false;
    (async () => {
      setItemsLoading(true);
      try {
        if (pickerSource === "tv") {
          const params = { country, limit: 600 };
          if (search.trim()) params.search = search.trim();
          const r = await axios.get(`${API}/channels`, { params, signal: ctrl.signal });
          if (cancelled) return;
          const list = (r.data.channels || []).map((c) => ({
            kind: "tv",
            id: c.id,
            name: c.name,
            country: c.country,
            categories: c.categories || [],
            src: buildSrc("tv", c),
          }));
          setItems(list);
        } else if (pickerSource === "daddy") {
          const params = { limit: 800 };
          if (daddyCountry) params.country = daddyCountry;
          if (search.trim()) params.search = search.trim();
          const r = await axios.get(`${API}/daddy/channels`, { params, signal: ctrl.signal });
          if (cancelled) return;
          setDaddyCountries(r.data.countries || []);
          const list = (r.data.channels || []).map((c) => ({
            kind: "daddy",
            id: c.id,
            name: c.name,
            country: c.country,
            category: c.category,
            src: buildSrc("daddy", c),
          }));
          setItems(list);
        } else if (pickerSource === "sports") {
          const r = await axios.get(`${API}/sports/matches`, { signal: ctrl.signal });
          if (cancelled) return;
          const events = r.data.events || [];
          const q = search.trim().toLowerCase();
          const filtered = q
            ? events.filter((e) =>
                (e.title || "").toLowerCase().includes(q)
                || (e.sport || "").toLowerCase().includes(q)
                || (e.league || "").toLowerCase().includes(q),
              )
            : events;
          const list = filtered
            .filter((e) => (e.sources || []).length > 0)
            .slice(0, 400)
            .map((e) => ({
              kind: "sports",
              id: e.id,
              name: e.title || `${e.home || ""} vs ${e.away || ""}`,
              country: e.sport || "",
              category: e.league || "",
              meta: { sport: e.sport, league: e.league, time: e.time, isLive: e.isLive },
              sources: e.sources,
              src: buildSrc("sports", e),
            }));
          setItems(list);
        } else if (pickerSource === "bosstv") {
          const r = await axios.get(`${API}/bosstv/matches`, { signal: ctrl.signal });
          if (cancelled) return;
          const matches = (r.data.matches || []).filter((m) => m.has_servers);
          const q = search.trim().toLowerCase();
          const filtered = q
            ? matches.filter((m) =>
                (m.title || "").toLowerCase().includes(q)
                || (m.home || "").toLowerCase().includes(q)
                || (m.away || "").toLowerCase().includes(q)
                || (m.league || "").toLowerCase().includes(q),
              )
            : matches;
          // Sort: live first, then upcoming, then by timestamp
          filtered.sort((a, b) => {
            if (a.is_live !== b.is_live) return a.is_live ? -1 : 1;
            return (a.timestamp || 0) - (b.timestamp || 0);
          });
          const list = filtered.slice(0, 400).map((m) => ({
            kind: "bosstv",
            id: m.id,
            name: m.title,
            country: "",
            category: m.league || "",
            has_servers: m.has_servers,
            server_count: m.server_count,
            meta: { league: m.league, time: m.time_label, isLive: m.is_live },
            src: buildSrc("bosstv", m),
          }));
          setItems(list);
        }
      } catch (e) {
        if (e.name !== "CanceledError" && e.code !== "ERR_CANCELED") {
          console.error(e);
          toast.error("Erreur de chargement");
        }
      } finally {
        if (!cancelled) setItemsLoading(false);
      }
    })();
    return () => { cancelled = true; ctrl.abort(); };
  }, [pickerOpen, pickerSource, country, search, daddyCountry]);

  const visibleCells = layout * layout;

  const openPicker = useCallback((index) => {
    setPickerTargetIndex(index);
    setSearch("");
    setPickerOpen(true);
  }, []);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setPickerTargetIndex(-1);
  }, []);

  const assignItem = useCallback((item) => {
    if (pickerTargetIndex < 0) return;
    if (!item.src) {
      toast.error("Cette source n'a pas de flux disponible");
      return;
    }
    setCells((prev) => {
      const next = prev.slice();
      next[pickerTargetIndex] = {
        kind: item.kind,
        id: item.id,
        name: item.name,
        country: item.country || "",
        category: item.category || item.categories?.[0] || "",
        src: item.src,
      };
      return next;
    });
    closePicker();
  }, [pickerTargetIndex, closePicker]);

  const clearCell = useCallback((index) => {
    setCells((prev) => {
      const next = prev.slice();
      next[index] = null;
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setCells(new Array(16).fill(null));
    toast.success("Toutes les cellules ont été vidées");
  }, []);

  const filledCount = cells.slice(0, visibleCells).filter(Boolean).length;

  const gridStyle = {
    gridTemplateColumns: `repeat(${layout}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${layout}, minmax(0, 1fr))`,
  };

  // Country list for the current picker source
  const activeCountries = pickerSource === "tv" ? countries : daddyCountries;

  return (
    <div className="relative min-h-screen text-white flex flex-col">
      <div className="ns-bg" />
      <div className="ns-grain" />

      {/* Header */}
      <header className="sticky top-0 z-40 glass" style={{ borderRadius: 0, backdropFilter: "blur(22px) saturate(140%)" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3 sm:gap-5">
          <Link to="/" className="player-btn shrink-0" data-testid="mv-back-btn" aria-label="Retour">
            <ArrowLeft size={18} />
          </Link>
          <div className="flex items-center gap-2.5 shrink-0" data-testid="brand-logo">
            <img
              src="https://i.imgur.com/V8YmT4z.png"
              alt="LiveWatch"
              className="h-7 sm:h-8 w-auto"
              draggable={false}
            />
            <span className="hidden sm:inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.18em] text-white/55 px-2.5 py-1 rounded-full glass-pill">
              <Grid3x3 size={12} /> Multiview
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* Layout selector */}
            <div className="flex items-center gap-1 p-1 rounded-full glass-pill" data-testid="mv-layout-selector">
              {LAYOUTS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLayout(l.id)}
                  className={`mv-layout-btn ${layout === l.id ? "active" : ""}`}
                  data-testid={`mv-layout-${l.id}`}
                  title={`Grille ${l.label}`}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <div className="hidden sm:flex items-center gap-2 glass-pill px-3 py-2 rounded-full" data-testid="mv-filled-count">
              <Tv2 size={14} className="text-[#ff2e63]" />
              <span className="text-sm font-semibold tabular-nums">{filledCount}</span>
              <span className="text-xs text-white/60">/ {visibleCells}</span>
            </div>
            <button
              onClick={clearAll}
              className="player-btn shrink-0"
              title="Tout effacer"
              data-testid="mv-clear-all"
              disabled={filledCount === 0}
              style={{ opacity: filledCount === 0 ? 0.4 : 1 }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Grid */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-5 py-4">
        <div
          className="mv-grid"
          style={gridStyle}
          data-testid={`mv-grid-${layout}x${layout}`}
        >
          {cells.slice(0, visibleCells).map((cell, idx) => (
            <MultiViewCell
              key={`cell-${idx}-${cell?.kind || "x"}-${cell?.id || "empty"}`}
              index={idx}
              channel={cell}
              onPick={() => openPicker(idx)}
              onClear={() => clearCell(idx)}
            />
          ))}
        </div>

        <div className="text-center text-white/40 text-xs mt-4">
          Chaque cellule charge la page d'embed (pub puis lecteur). Cliquez dans le lecteur pour activer le son.
        </div>
      </main>

      {/* Picker modal */}
      {pickerOpen && (
        <div className="mv-picker-overlay" data-testid="mv-picker" onClick={closePicker}>
          <div className="mv-picker-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mv-picker-head">
              <div className="flex items-center gap-2">
                <Grid3x3 size={16} className="text-[#ff2e63]" />
                <h3 className="text-white font-semibold">
                  Choisir une source — Slot {pickerTargetIndex + 1}
                </h3>
              </div>
              <button onClick={closePicker} className="player-btn" data-testid="mv-picker-close">
                <XIcon size={18} />
              </button>
            </div>

            {/* Source tabs */}
            <div className="px-4 pb-3 pt-1 flex gap-2 overflow-x-auto no-scrollbar border-b border-white/5">
              {SOURCE_TABS.map((t) => {
                const Icon = t.icon;
                const active = pickerSource === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => { setPickerSource(t.id); setSearch(""); }}
                    data-testid={`mv-picker-tab-${t.id}`}
                    className={`mv-source-tab ${active ? "is-active" : ""}`}
                    style={active ? { color: t.color, borderColor: `${t.color}66` } : undefined}
                  >
                    <Icon size={14} /> {t.label}
                  </button>
                );
              })}
            </div>

            <div className="mv-picker-filters">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={
                    pickerSource === "sports"
                      ? "Rechercher un match, sport ou ligue…"
                      : pickerSource === "bosstv"
                      ? "Rechercher un match BossTV…"
                      : "Rechercher une chaîne…"
                  }
                  data-testid="mv-picker-search"
                  autoFocus
                  className="w-full pl-9 pr-3 py-2 rounded-full glass-pill text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/20"
                />
              </div>

              {(pickerSource === "tv" || pickerSource === "daddy") && (
                <Select
                  value={pickerSource === "daddy" ? (daddyCountry || "__all__") : country}
                  onValueChange={(v) => {
                    if (pickerSource === "daddy") {
                      setDaddyCountry(v === "__all__" ? "" : v);
                    } else {
                      setCountry(v);
                    }
                  }}
                >
                  <SelectTrigger
                    data-testid="mv-picker-country"
                    className="glass-pill border-white/10 rounded-full px-3 py-2 h-auto text-sm gap-2 min-w-[160px]"
                  >
                    <Globe2 size={14} className="text-white/60" />
                    <SelectValue placeholder={pickerSource === "daddy" ? "Tous les pays" : undefined} />
                  </SelectTrigger>
                  <SelectContent className="glass-heavy border-white/10 max-h-[340px]">
                    {pickerSource === "daddy" && (
                      <SelectItem value="__all__">Tous les pays</SelectItem>
                    )}
                    {activeCountries.map((c) => (
                      <SelectItem key={c} value={c} data-testid={`mv-country-option-${c}`}>
                        <span className="inline-flex items-center gap-2">
                          <FlagIcon country={c} size={18} />
                          {c}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="mv-picker-list" data-testid="mv-picker-list">
              {itemsLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="animate-spin text-[#ff2e63]" size={26} />
                </div>
              ) : items.length === 0 ? (
                <div className="text-center text-white/50 py-10 text-sm">Aucun résultat.</div>
              ) : (
                <div className="mv-picker-grid">
                  {items.map((it) => (
                    <button
                      key={`${it.kind}-${it.id}`}
                      onClick={() => assignItem(it)}
                      className="mv-picker-item"
                      data-testid={`mv-picker-item-${it.kind}-${it.id}`}
                      title={it.name}
                    >
                      <div className="mv-picker-item-icon">
                        {it.kind === "tv" && <Tv2 size={18} className="text-white/50" />}
                        {it.kind === "daddy" && <Radio size={18} className="text-[#ff8a00]" />}
                        {it.kind === "sports" && <Trophy size={18} className="text-emerald-400" />}
                        {it.kind === "bosstv" && <Crown size={18} className="text-fuchsia-400" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{it.name}</p>
                        <p className="text-[11px] text-white/45 truncate uppercase tracking-wider flex items-center gap-1.5">
                          {it.kind === "tv" && (
                            <>
                              <FlagIcon country={it.country} size={12} />
                              {it.categories?.[0] || "TV"}
                            </>
                          )}
                          {it.kind === "daddy" && (
                            <>
                              <FlagIcon country={it.country} size={12} />
                              {it.category || "Daddy"}
                            </>
                          )}
                          {it.kind === "sports" && (
                            <>{it.meta?.sport || "Sport"} · {it.meta?.time || ""}</>
                          )}
                          {it.kind === "bosstv" && (
                            <>
                              {it.meta?.isLive && <span className="text-red-400">● LIVE</span>}
                              {!it.meta?.isLive && (it.meta?.league || "BossTV")} · {it.meta?.time || ""}
                            </>
                          )}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
