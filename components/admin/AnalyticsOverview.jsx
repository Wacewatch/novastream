import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend, Cell as RCell,
} from "recharts";
import {
  Activity, Users, Crown, ExternalLink, Eye, UserX, RefreshCw, Loader2,
  TrendingUp, TrendingDown, Minus, Download, Radio, Globe, Flame,
} from "lucide-react";

const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || process.env.REACT_APP_BACKEND_URL || (typeof window !== "undefined" ? window.location.origin : ""));
const API = `${BACKEND_URL}/api`;

const RANGES = [
  { id: "24h", label: "24 h" },
  { id: "7d", label: "7 j" },
  { id: "30d", label: "30 j" },
  { id: "1y", label: "1 an" },
];

const KPI_DEFS = [
  { key: "total_plays", label: "Lectures totales", color: "#ec4899", Icon: Activity },
  { key: "unique_visitors", label: "Visiteurs uniques", color: "#22c55e", Icon: Users },
  { key: "member_plays", label: "Membres", color: "#06b6d4", Icon: Eye },
  { key: "vip_plays", label: "VIP", color: "#f59e0b", Icon: Crown },
  { key: "guest_plays", label: "Invités", color: "#94a3b8", Icon: UserX },
  { key: "embed_plays", label: "Embeds", color: "#a855f7", Icon: ExternalLink },
];

const DIST_DEFS = [
  { key: "member", label: "Membres", color: "#06b6d4" },
  { key: "vip", label: "VIP", color: "#f59e0b" },
  { key: "guest", label: "Invités", color: "#94a3b8" },
  { key: "embed", label: "Embeds", color: "#a855f7" },
];

const CHANNEL_COLORS = ["#ec4899", "#06b6d4", "#22c55e", "#f59e0b", "#a855f7", "#3b82f6", "#f43f5e", "#14b8a6"];

function fmt(n) {
  return Number(n || 0).toLocaleString("fr-FR");
}

function Trend({ pct }) {
  if (pct === null || pct === undefined) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-white/35">
        <Minus size={11} /> —
      </span>
    );
  }
  const up = pct >= 0;
  const Icon = pct === 0 ? Minus : up ? TrendingUp : TrendingDown;
  const cls = pct === 0 ? "text-white/40" : up ? "text-green-400" : "text-red-400";
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${cls}`}>
      <Icon size={11} /> {up && pct !== 0 ? "+" : ""}{pct}%
    </span>
  );
}

export default function AnalyticsOverview({ getAuthHeader }) {
  const [range, setRange] = useState("7d");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [auto, setAuto] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeader();
      const r = await axios.get(
        `${API}/admin/analytics-overview?range=${encodeURIComponent(range)}`,
        { headers },
      );
      setData(r.data);
    } catch (e) {
      setError(e?.response?.data?.detail || "Impossible de charger les analytics");
    } finally {
      setLoading(false);
    }
  }, [range, getAuthHeader]);

  useEffect(() => {
    load();
    if (!auto) return;
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load, auto]);

  const kpis = data?.kpis || {};
  const distribution = data?.distribution || {};
  const topChannels = data?.top_channels || [];
  const topCountries = data?.top_countries || [];
  const bySource = data?.by_source || [];
  const peak = data?.peak || null;

  const distData = useMemo(
    () => DIST_DEFS.map((d) => ({ name: d.label, value: distribution[d.key] || 0, color: d.color })),
    [distribution],
  );
  const distTotal = useMemo(() => distData.reduce((s, d) => s + d.value, 0), [distData]);

  const maxCountry = useMemo(
    () => topCountries.reduce((m, c) => Math.max(m, c.plays || 0), 0) || 1,
    [topCountries],
  );

  const rangeLabel = RANGES.find((r) => r.id === range)?.label || range;

  const exportCsv = () => {
    const rows = [["metric", "current", "previous", "delta_pct"]];
    KPI_DEFS.forEach(({ key, label }) => {
      const k = kpis[key] || {};
      rows.push([label, k.current ?? 0, k.previous ?? 0, k.delta_pct ?? ""]);
    });
    rows.push([]);
    rows.push(["top_channel", "country", "plays"]);
    topChannels.forEach((c) => rows.push([c.name, c.country, c.plays]));
    rows.push([]);
    rows.push(["top_country", "plays"]);
    topCountries.forEach((c) => rows.push([c.country, c.plays]));
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `livewatch-analytics-${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const peakWhen = useMemo(() => {
    if (!peak?.t) return "—";
    try {
      const d = new Date(peak.t);
      return data?.bucket === "hour"
        ? d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
        : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long" });
    } catch {
      return peak.t;
    }
  }, [peak, data?.bucket]);

  return (
    <section className="glass-heavy rounded-2xl p-5 border border-white/10" data-testid="admin-analytics-overview">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Activity size={18} className="text-pink-400" />
          Vue d'ensemble analytics
          {loading && <Loader2 size={14} className="animate-spin text-white/40" />}
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-white/[0.04] border border-white/10 rounded-lg p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                  range === r.id ? "bg-pink-400/20 text-pink-300" : "text-white/60 hover:text-white"
                }`}
                data-testid={`analytics-range-${r.id}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setAuto((a) => !a)}
            className={`px-2.5 py-1.5 text-[11px] font-medium rounded-md border transition ${
              auto ? "border-green-400/40 text-green-300 bg-green-400/10" : "border-white/10 text-white/50"
            }`}
            title="Rafraîchissement automatique (60 s)"
          >
            Auto {auto ? "ON" : "OFF"}
          </button>
          <button
            onClick={exportCsv}
            className="p-1.5 text-white/50 hover:text-white border border-white/10 rounded-md"
            title="Exporter en CSV"
            data-testid="analytics-export"
          >
            <Download size={14} />
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 text-white/50 hover:text-white border border-white/10 rounded-md disabled:opacity-50"
            title="Rafraîchir"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 px-3 py-2 text-sm mb-4">
          {error}
        </div>
      )}

      {/* KPI cards with trend vs previous period */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        {KPI_DEFS.map(({ key, label, color, Icon }) => {
          const k = kpis[key] || {};
          return (
            <div
              key={key}
              className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
              data-testid={`analytics-kpi-${key}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: `${color}22`, color }}
                >
                  <Icon size={14} />
                </span>
                <Trend pct={k.delta_pct} />
              </div>
              <p className="text-2xl font-extrabold tabular-nums" style={{ color }}>
                {fmt(k.current)}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-white/45 mt-0.5">{label}</p>
              <p className="text-[10px] text-white/30 mt-1">
                préc. {fmt(k.previous)}
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Audience distribution donut */}
        <div className="rounded-xl border border-white/10 bg-black/30 p-4" data-testid="analytics-distribution">
          <div className="flex items-center gap-2 mb-3 text-white/70">
            <Users size={15} className="text-cyan-400" />
            <span className="text-sm font-semibold">Répartition audience</span>
          </div>
          {distTotal === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-white/40 text-sm">
              Aucune donnée sur {rangeLabel}.
            </div>
          ) : (
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={distData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {distData.map((d) => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                    formatter={(v, n) => [`${fmt(v)} (${Math.round((v / distTotal) * 100)}%)`, n]}
                  />
                  <Legend
                    iconType="circle"
                    wrapperStyle={{ fontSize: 11 }}
                    formatter={(value) => <span className="text-white/60">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Top channels horizontal bars */}
        <div className="rounded-xl border border-white/10 bg-black/30 p-4 lg:col-span-2" data-testid="analytics-top-channels">
          <div className="flex items-center gap-2 mb-3 text-white/70">
            <Radio size={15} className="text-orange-400" />
            <span className="text-sm font-semibold">Top chaînes ({rangeLabel})</span>
          </div>
          {topChannels.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-white/40 text-sm">
              Aucune lecture enregistrée sur {rangeLabel}.
            </div>
          ) : (
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topChannels} layout="vertical" margin={{ top: 0, right: 20, left: 8, bottom: 0 }}>
                  <XAxis type="number" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 11 }}
                    width={120}
                    tickFormatter={(v) => (v.length > 16 ? v.slice(0, 15) + "…" : v)}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.05)" }}
                    contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                    formatter={(v) => [`${fmt(v)} lectures`, "Lectures"]}
                  />
                  <Bar dataKey="plays" radius={[0, 4, 4, 0]}>
                    {topChannels.map((c, i) => (
                      <RCell key={c.id} fill={CHANNEL_COLORS[i % CHANNEL_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        {/* Top countries */}
        <div className="rounded-xl border border-white/10 bg-black/30 p-4 lg:col-span-2" data-testid="analytics-top-countries">
          <div className="flex items-center gap-2 mb-3 text-white/70">
            <Globe size={15} className="text-blue-400" />
            <span className="text-sm font-semibold">Top pays ({rangeLabel})</span>
          </div>
          {topCountries.length === 0 ? (
            <p className="text-sm text-white/40 py-6 text-center">Aucune donnée sur {rangeLabel}.</p>
          ) : (
            <div className="space-y-2.5">
              {topCountries.map((c, i) => (
                <div key={c.country + i} className="flex items-center gap-3">
                  <span className="text-xs text-white/40 w-5 tabular-nums">#{i + 1}</span>
                  <span className="text-sm text-white/80 w-32 truncate">{c.country}</span>
                  <div className="flex-1 h-2.5 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400"
                      style={{ width: `${Math.max(4, (c.plays / maxCountry) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-white/70 tabular-nums w-14 text-right">{fmt(c.plays)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Peak activity */}
        <div className="rounded-xl border border-white/10 bg-black/30 p-4 flex flex-col justify-center" data-testid="analytics-peak">
          <div className="flex items-center gap-2 mb-3 text-white/70">
            <Flame size={15} className="text-red-400" />
            <span className="text-sm font-semibold">Pic d'activité</span>
          </div>
          <p className="text-4xl font-extrabold text-red-400 tabular-nums">{fmt(peak?.total)}</p>
          <p className="text-xs text-white/50 mt-1">lectures</p>
          <p className="text-sm text-white/70 mt-3 pt-3 border-t border-white/5">{peakWhen}</p>
        </div>
      </div>

      {/* Lectures par source */}
      {bySource.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-black/30 p-4 mt-4" data-testid="analytics-by-source">
          <div className="flex items-center gap-2 mb-3 text-white/70">
            <Radio size={15} className="text-pink-400" />
            <span className="text-sm font-semibold">Lectures par source ({rangeLabel})</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
            {bySource.map((s, i) => {
              const maxSrc = bySource.reduce((m, x) => Math.max(m, x.plays || 0), 0) || 1;
              const color = CHANNEL_COLORS[i % CHANNEL_COLORS.length];
              return (
                <div key={s.source} className="flex items-center gap-3">
                  <span className="text-sm text-white/80 w-24 truncate">{s.label}</span>
                  <div className="flex-1 h-2.5 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(3, (s.plays / maxSrc) * 100)}%`, background: color }}
                    />
                  </div>
                  <span className="text-xs text-white/70 tabular-nums w-16 text-right">{fmt(s.plays)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
