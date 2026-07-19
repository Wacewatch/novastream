import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Search, Loader2, Tv2, Globe2 } from "lucide-react";
import { toast } from "sonner";
import ChannelCard from "@/components/ChannelCard";

const API = `${process.env.NEXT_PUBLIC_BACKEND_URL || process.env.REACT_APP_BACKEND_URL || ''}/api`;

function detectQuality(name = "") {
  const s = name.toUpperCase();
  if (/\b(4K|UHD)\b/.test(s)) return "4K";
  if (/\bFHD\b/.test(s)) return "FHD";
  if (/\bHD\b/.test(s)) return "HD";
  return null;
}

function toCard(ch) {
  return {
    id: `frame:${ch.id}`,
    name: ch.name,
    logo: ch.logo || "",
    source: "iptv",
    quality: detectQuality(ch.name),
    country: ch.group || "",
    country_code: "frame",
    viewers: 0,
    _raw: ch,
  };
}

export default function FrameTvTab({ onPick }) {
  const [channels, setChannels] = useState([]);
  const [groups, setGroups] = useState([]);
  const [group, setGroup] = useState("France");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = {};
        if (group) params.group = group;
        if (search.trim()) params.search = search.trim();
        const r = await axios.get(`${API}/frame/channels`, { params });
        if (cancelled) return;
        setChannels(r.data?.channels || []);
        if (Array.isArray(r.data?.groups) && r.data.groups.length) setGroups(r.data.groups);
      } catch (e) {
        console.error(e);
        if (!cancelled) toast.error("Erreur de chargement FrameTV");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [group, search]);

  const cards = useMemo(() => channels.map(toCard), [channels]);

  return (
    <div className="space-y-4" data-testid="frame-tab">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une chaîne…"
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-[#00d2ff]/50"
          />
        </div>
        <div className="relative">
          <Globe2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            className="pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm appearance-none cursor-pointer focus:outline-none focus:border-[#00d2ff]/50"
          >
            <option value="">Tous les pays</option>
            {groups.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
        <span className="ml-auto text-xs text-white/45">{channels.length} chaînes</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-[#00d2ff]" size={32} />
          <span className="ml-3 text-white/60">Chargement FrameTV…</span>
        </div>
      ) : cards.length === 0 ? (
        <div className="glass rounded-2xl p-10 text-center">
          <Tv2 className="mx-auto text-white/30 mb-3" size={36} />
          <p className="text-white/70">Aucune chaîne trouvée.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {cards.map((c) => (
            <ChannelCard key={c.id} channel={c} onClick={() => onPick?.(c._raw)} />
          ))}
        </div>
      )}
    </div>
  );
}
