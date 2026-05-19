import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Loader2, Info as InfoIcon, Calendar, Radio, Search } from "lucide-react";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Informations tab (tv247.us). When a channel is clicked, we resolve it
 * against the DaddyTV catalog: first by channel_id, fallback by name match.
 * On success, calls onResolveChannel(daddyChannel) — the parent then runs
 * the ad modal & opens the iframe player directly.
 */
export default function InfoTab({ onResolveChannel }) {
  const [data, setData] = useState({ days: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [daddyIndex, setDaddyIndex] = useState({ byId: {}, byName: {} });
  const [resolving, setResolving] = useState(null);

  // Load planning
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await axios.get(`${API}/sports/info`);
        if (!cancelled) setData(r.data);
      } catch (e) {
        console.error(e);
        if (!cancelled) toast.error("Informations indisponibles");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Preload DaddyTV catalog index for name matching
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API}/daddy/channels`);
        const list = r.data?.channels || [];
        const byId = {};
        const byName = {};
        for (const c of list) {
          byId[String(c.id)] = c;
          byName[normalizeName(c.name)] = c;
        }
        if (!cancelled) setDaddyIndex({ byId, byName });
      } catch (e) {
        console.error("daddy index load failed", e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const resolveChannel = async (rawId, rawName) => {
    if (resolving) return;
    const key = `${rawId}|${rawName}`;
    setResolving(key);
    try {
      // 1. Try by ID
      if (rawId && daddyIndex.byId[String(rawId)]) {
        onResolveChannel?.(daddyIndex.byId[String(rawId)]);
        return;
      }
      // 2. Try by normalized name
      if (rawName) {
        const norm = normalizeName(rawName);
        if (daddyIndex.byName[norm]) {
          onResolveChannel?.(daddyIndex.byName[norm]);
          return;
        }
        // 3. Fuzzy: try a "starts with" match
        const lower = norm;
        const candidate = Object.entries(daddyIndex.byName).find(([k]) => k.startsWith(lower) || lower.startsWith(k));
        if (candidate) {
          onResolveChannel?.(candidate[1]);
          return;
        }
      }
      // 4. Last resort: ask backend for the channel by id
      if (rawId) {
        try {
          const r = await axios.get(`${API}/daddy/channel/${encodeURIComponent(rawId)}`);
          if (r.data) {
            onResolveChannel?.(r.data);
            return;
          }
        } catch (_) { /* fallthrough */ }
      }
      toast.error(`Chaîne « ${rawName || rawId} » indisponible`);
    } finally {
      setResolving(null);
    }
  };

  const filteredDays = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.days;
    return (data.days || []).map((d) => ({
      ...d,
      events: d.events.filter((e) =>
        (e.event || "").toLowerCase().includes(q) ||
        (e.channels || []).some((c) => (c.channel_name || "").toLowerCase().includes(q))
      ),
    })).filter((d) => d.events.length > 0);
  }, [data.days, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="info-loading">
        <Loader2 className="animate-spin text-blue-400" size={32} />
        <span className="ml-3 text-white/60">Chargement du planning…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="info-content">
      <div className="glass rounded-2xl p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-1">
          <InfoIcon size={16} className="text-blue-400" />
          <div className="text-white font-extrabold">Planning du jour</div>
        </div>
        <div className="text-xs text-white/55">
          Programme des événements et chaînes (source tv247.us, données issues de DaddyLive).
          Cliquez sur une chaîne pour lancer le direct.
        </div>
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
        <input
          data-testid="info-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un événement ou une chaîne…"
          className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-blue-500/50"
        />
      </div>

      {filteredDays.length === 0 ? (
        <div className="glass rounded-2xl p-10 text-center">
          <div className="text-white/80 font-semibold">Aucun événement</div>
        </div>
      ) : (
        filteredDays.map((day, di) => (
          <div key={`day-${di}`} className="space-y-3">
            <h3 className="text-white font-extrabold text-lg flex items-center gap-2">
              <Calendar size={16} className="text-blue-400" /> {day.day}
            </h3>
            <div className="space-y-2">
              {day.events.map((ev, ei) => (
                <div key={`ev-${di}-${ei}`} className="glass rounded-xl p-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-3">
                  <div className="text-blue-300 font-bold text-sm shrink-0 w-16">{ev.time}</div>
                  <div className="flex-1 text-white/90 text-sm">{ev.event}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(ev.channels || []).map((c) => {
                      const cid = String(c.channel_id || "");
                      const cname = c.channel_name || "";
                      const matched =
                        !!daddyIndex.byId[cid] ||
                        !!daddyIndex.byName[normalizeName(cname)];
                      const key = `${cid}|${cname}`;
                      const isResolving = resolving === key;
                      return (
                        <button
                          key={key}
                          onClick={() => resolveChannel(cid, cname)}
                          disabled={isResolving}
                          className={`text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-md border transition-all ${
                            matched
                              ? "bg-[#ff8a00]/5 border-[#ff8a00]/30 text-[#ffb066] hover:bg-[#ff8a00]/15 hover:text-white"
                              : "bg-white/5 border-white/10 text-white/70 hover:border-[#ff8a00]/40 hover:text-white"
                          }`}
                          data-testid={`info-ch-${cid}`}
                          title={matched ? "Cliquer pour lancer le direct" : "Tenter d'ouvrir cette chaîne"}
                        >
                          {isResolving ? (
                            <Loader2 size={10} className="animate-spin" />
                          ) : (
                            <Radio size={10} />
                          )}
                          {cname}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function normalizeName(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+hd\s*$/i, "")
    .replace(/\s+\d+p\s*$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
