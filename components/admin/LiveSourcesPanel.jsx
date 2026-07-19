import { useMemo } from "react";
import {
  Tv, Radio, Trophy, Flame, Crown, Zap, Film, Globe, Activity,
} from "lucide-react";

// Visual identity per source
const SOURCE_META = {
  livetv:  { label: "LiveTV",   Icon: Tv,     color: "#ec4899" },
  frametv: { label: "FrameTV",  Icon: Film,   color: "#22d3ee" },
  northtv: { label: "NorthTV",  Icon: Globe,  color: "#60a5fa" },
  daddytv: { label: "DaddyTV",  Icon: Radio,  color: "#f97316" },
  sports:  { label: "Sports",   Icon: Trophy, color: "#f59e0b" },
  football:{ label: "Football", Icon: Flame,  color: "#ef4444" },
  bosstv:  { label: "BossTV",   Icon: Crown,  color: "#a855f7" },
  jacktv:  { label: "JackTV",   Icon: Zap,    color: "#14b8a6" },
};

function fmt(n) {
  return Number(n || 0).toLocaleString("fr-FR");
}

export default function LiveSourcesPanel({ bySource }) {
  const rows = useMemo(() => {
    const list = Array.isArray(bySource) ? bySource : [];
    // Ensure all known sources appear even at 0
    const known = Object.keys(SOURCE_META);
    const map = new Map(list.map((r) => [r.source, r]));
    const merged = known.map((key) => {
      const r = map.get(key) || {};
      return {
        source: key,
        label: r.label || SOURCE_META[key].label,
        online: r.online || 0,
        total_24h: r.total_24h || 0,
      };
    });
    // include any unknown sources returned by the backend
    list.forEach((r) => {
      if (!SOURCE_META[r.source]) merged.push({ ...r });
    });
    return merged.sort((a, b) => b.online - a.online || b.total_24h - a.total_24h);
  }, [bySource]);

  const totalOnline = rows.reduce((s, r) => s + r.online, 0);
  const maxOnline = rows.reduce((m, r) => Math.max(m, r.online), 0) || 1;

  return (
    <section className="glass-heavy rounded-2xl p-5 border border-white/10" data-testid="admin-live-sources">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Activity size={18} className="text-green-400" />
          Stats en direct par source
          <span className="ml-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-green-400 px-2 py-0.5 rounded-full bg-green-500/10">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> LIVE
          </span>
        </h3>
        <span className="text-xs text-white/40">
          {fmt(totalOnline)} spectateurs en ligne · MàJ 5 s
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {rows.map(({ source, label, online, total_24h }) => {
          const meta = SOURCE_META[source] || { label, Icon: Tv, color: "#94a3b8" };
          const Icon = meta.Icon;
          const share = totalOnline > 0 ? Math.round((online / totalOnline) * 100) : 0;
          return (
            <div
              key={source}
              className="rounded-xl border border-white/10 bg-white/[0.02] p-4 relative overflow-hidden"
              data-testid={`live-source-${source}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: `${meta.color}22`, color: meta.color }}
                >
                  <Icon size={16} />
                </span>
                {online > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-green-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> live
                  </span>
                )}
              </div>
              <p className="text-[11px] uppercase tracking-wider text-white/50">{label}</p>
              <div className="flex items-end gap-2 mt-1">
                <p className="text-3xl font-extrabold tabular-nums" style={{ color: meta.color }}>
                  {fmt(online)}
                </p>
                <p className="text-[11px] text-white/40 mb-1.5">en ligne</p>
              </div>

              {/* share bar */}
              <div className="mt-2 h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.max(3, (online / maxOnline) * 100)}%`, background: meta.color }}
                />
              </div>

              <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5 text-[11px]">
                <span className="text-white/40">{share}% du live</span>
                <span className="text-white/60 tabular-nums">{fmt(total_24h)} / 24 h</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
