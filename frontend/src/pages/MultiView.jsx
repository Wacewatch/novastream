import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { Search, Globe2, Grid3x3, ArrowLeft, Tv2, Trash2, Loader2, X as XIcon } from "lucide-react";
import MultiViewCell from "@/components/MultiViewCell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const STORAGE_KEY = "livewatch.multiview.v1";

const LAYOUTS = [
  { id: 2, label: "2×2", cells: 4 },
  { id: 3, label: "3×3", cells: 9 },
  { id: 4, label: "4×4", cells: 16 },
];

const COUNTRY_FLAGS = {
  France: "🇫🇷", Germany: "🇩🇪", Italy: "🇮🇹", Spain: "🇪🇸",
  "United Kingdom": "🇬🇧", "United States": "🇺🇸", Portugal: "🇵🇹",
  Netherlands: "🇳🇱", Belgium: "🇧🇪", Switzerland: "🇨🇭", Poland: "🇵🇱",
  Russia: "🇷🇺", Turkey: "🇹🇷", Romania: "🇷🇴", Greece: "🇬🇷",
  Austria: "🇦🇹", Sweden: "🇸🇪", Denmark: "🇩🇰", Norway: "🇳🇴", Finland: "🇫🇮",
  Albania: "🇦🇱", Arabia: "🇸🇦", Bulgaria: "🇧🇬", Czech: "🇨🇿",
  Croatia: "🇭🇷", Hungary: "🇭🇺", Ireland: "🇮🇪", Serbia: "🇷🇸",
  Ukraine: "🇺🇦", India: "🇮🇳", Brazil: "🇧🇷", Mexico: "🇲🇽",
  Argentina: "🇦🇷", Canada: "🇨🇦", Australia: "🇦🇺",
};
const flagFor = (c) => COUNTRY_FLAGS[c] || "📺";

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

export default function MultiView() {
  const initial = useMemo(() => loadState(), []);
  const [layout, setLayout] = useState(initial?.layout || 2);
  // cells: array of {id, name, country, categories} | null
  const [cells, setCells] = useState(() => {
    const init = initial?.cells || [];
    const arr = new Array(16).fill(null);
    for (let i = 0; i < Math.min(16, init.length); i++) {
      if (init[i] && init[i].id && init[i].name) arr[i] = init[i];
    }
    return arr;
  });

  // Picker modal
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTargetIndex, setPickerTargetIndex] = useState(-1);

  const [countries, setCountries] = useState(["France"]);
  const [country, setCountry] = useState(initial?.lastCountry || "France");
  const [search, setSearch] = useState("");
  const [channels, setChannels] = useState([]);
  const [channelsLoading, setChannelsLoading] = useState(false);

  // Persist state
  useEffect(() => {
    saveState({ layout, cells, lastCountry: country });
  }, [layout, cells, country]);

  // Fetch countries once
  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${API}/countries`);
        const list = r.data.countries || [];
        setCountries(["France", ...list.filter((c) => c !== "France")]);
      } catch (_) { /* noop */ }
    })();
  }, []);

  // Load channels list when picker is open + filters change
  useEffect(() => {
    if (!pickerOpen) return;
    const ctrl = new AbortController();
    let cancelled = false;
    (async () => {
      setChannelsLoading(true);
      try {
        const params = { country, limit: 600 };
        if (search.trim()) params.search = search.trim();
        const r = await axios.get(`${API}/channels`, { params, signal: ctrl.signal });
        if (cancelled) return;
        setChannels(r.data.channels || []);
      } catch (e) {
        if (e.name !== "CanceledError" && e.code !== "ERR_CANCELED") {
          toast.error("Erreur lors du chargement des chaînes");
        }
      } finally {
        if (!cancelled) setChannelsLoading(false);
      }
    })();
    return () => { cancelled = true; ctrl.abort(); };
  }, [pickerOpen, country, search]);

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

  const assignChannel = useCallback((ch) => {
    if (pickerTargetIndex < 0) return;
    setCells((prev) => {
      const next = prev.slice();
      next[pickerTargetIndex] = {
        id: ch.id,
        name: ch.name,
        country: ch.country,
        categories: ch.categories || [],
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
          {cells.slice(0, visibleCells).map((ch, idx) => (
            <MultiViewCell
              key={`cell-${idx}-${ch?.id || "empty"}`}
              index={idx}
              channel={ch}
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
                  Choisir une chaîne — Slot {pickerTargetIndex + 1}
                </h3>
              </div>
              <button onClick={closePicker} className="player-btn" data-testid="mv-picker-close">
                <XIcon size={18} />
              </button>
            </div>

            <div className="mv-picker-filters">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher une chaîne…"
                  data-testid="mv-picker-search"
                  autoFocus
                  className="w-full pl-9 pr-3 py-2 rounded-full glass-pill text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/20"
                />
              </div>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger
                  data-testid="mv-picker-country"
                  className="glass-pill border-white/10 rounded-full px-3 py-2 h-auto text-sm gap-2 min-w-[140px]"
                >
                  <Globe2 size={14} className="text-white/60" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="glass-heavy border-white/10 max-h-[340px]">
                  {countries.map((c) => (
                    <SelectItem key={c} value={c} data-testid={`mv-country-option-${c}`}>
                      <span className="mr-2">{flagFor(c)}</span>{c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="mv-picker-list" data-testid="mv-picker-list">
              {channelsLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="animate-spin text-[#ff2e63]" size={26} />
                </div>
              ) : channels.length === 0 ? (
                <div className="text-center text-white/50 py-10 text-sm">Aucune chaîne trouvée.</div>
              ) : (
                <div className="mv-picker-grid">
                  {channels.map((ch) => (
                    <button
                      key={ch.id}
                      onClick={() => assignChannel(ch)}
                      className="mv-picker-item"
                      data-testid={`mv-picker-item-${ch.id}`}
                      title={ch.name}
                    >
                      <div className="mv-picker-item-icon">
                        <Tv2 size={18} className="text-white/50" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{ch.name}</p>
                        <p className="text-[11px] text-white/45 truncate uppercase tracking-wider">
                          {ch.categories?.[0] || "TV"}
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
