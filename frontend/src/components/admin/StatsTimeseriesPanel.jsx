import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import {
  BarChart3, Users, Crown, ExternalLink, Eye, RefreshCw, Loader2,
} from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const RANGES = [
  { id: "24h", label: "24 heures" },
  { id: "7d", label: "7 jours" },
  { id: "30d", label: "30 jours" },
  { id: "1y", label: "1 an" },
];

const SERIES = [
  { key: "unique_visitors", label: "Visiteurs uniques", color: "#22c55e", Icon: Users },
  { key: "member_plays",   label: "Lectures membres",  color: "#06b6d4", Icon: Eye },
  { key: "vip_plays",      label: "Lectures VIP",      color: "#f59e0b", Icon: Crown },
  { key: "embed_plays",    label: "Lectures embed",    color: "#a855f7", Icon: ExternalLink },
];

function formatTick(t, bucket) {
  if (!t) return "";
  try {
    const d = new Date(t);
    if (bucket === "hour") {
      return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  } catch {
    return t;
  }
}

function CustomTooltip({ active, payload, label, bucket }) {
  if (!active || !payload?.length) return null;
  let when = "";
  try {
    const d = new Date(label);
    when = bucket === "hour"
      ? d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  } catch {
    when = label;
  }
  return (
    <div className="bg-zinc-900/95 border border-white/10 rounded-lg p-3 shadow-xl text-xs">
      <div className="text-white/70 mb-1.5">{when}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
          <span className="text-white/60">{p.name}</span>
          <span className="ml-auto tabular-nums text-white font-semibold">
            {Number(p.value || 0).toLocaleString("fr-FR")}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function StatsTimeseriesPanel({ getAuthHeader }) {
  const [range, setRange] = useState("7d");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hiddenSeries, setHiddenSeries] = useState({}); // {key: true} when hidden

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeader();
      const r = await axios.get(
        `${API}/admin/stats-timeseries?range=${encodeURIComponent(range)}`,
        { headers },
      );
      setData(r.data);
    } catch (e) {
      setError(e?.response?.data?.detail || "Impossible de charger les statistiques");
    } finally {
      setLoading(false);
    }
  }, [range, getAuthHeader]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000); // auto-refresh 60s (server cache = 60s)
    return () => clearInterval(t);
  }, [load]);

  const bucket = data?.bucket || (range === "24h" ? "hour" : "day");
  const buckets = data?.buckets || [];
  const totals = data?.totals || {};

  // Average per day (only for ranges with bucket=day)
  const avgPerDay = useMemo(() => {
    if (bucket !== "day" || buckets.length === 0) return null;
    return Math.round((totals.total || 0) / buckets.length);
  }, [bucket, buckets.length, totals.total]);

  return (
    <section
      className="glass-heavy rounded-2xl p-5 border border-white/10 col-span-full"
      data-testid="admin-stats-timeseries"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <BarChart3 size={18} className="text-cyan-400" />
          Statistiques détaillées
          {loading && <Loader2 size={14} className="animate-spin text-white/40" />}
          <span className="text-xs font-normal text-white/40 hidden sm:inline">
            • auto-refresh 60 s
          </span>
        </h3>
        <div className="flex items-center gap-2">
          {/* Range tabs */}
          <div className="flex bg-white/[0.04] border border-white/10 rounded-lg p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                  range === r.id
                    ? "bg-cyan-400/20 text-cyan-300"
                    : "text-white/60 hover:text-white"
                }`}
                data-testid={`range-${r.id}`}
              >
                {r.label}
              </button>
            ))}
          </div>
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

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {SERIES.map(({ key, label, color, Icon }) => (
          <div
            key={key}
            className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
            data-testid={`kpi-${key}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider text-white/40">
                {label}
              </span>
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center"
                style={{ background: `${color}22`, color }}
              >
                <Icon size={14} />
              </span>
            </div>
            <p
              className="text-3xl font-extrabold tabular-nums"
              style={{ color }}
            >
              {(
                (key === "unique_visitors"
                  ? (data?.range_unique_visitors ?? totals[key])
                  : totals[key]) || 0
              ).toLocaleString("fr-FR")}
            </p>
            <p className="text-[10px] text-white/35 mt-1">
              sur {RANGES.find((x) => x.id === range)?.label.toLowerCase()}
            </p>
          </div>
        ))}
      </div>

      {avgPerDay !== null && (
        <div className="text-xs text-white/45 mb-3">
          Moyenne :{" "}
          <span className="text-white/75 font-semibold tabular-nums">
            {avgPerDay.toLocaleString("fr-FR")}
          </span>{" "}
          lectures / jour
          <span className="mx-2 text-white/20">•</span>
          Total lectures :{" "}
          <span className="text-white/75 font-semibold tabular-nums">
            {(totals.total || 0).toLocaleString("fr-FR")}
          </span>
        </div>
      )}

      {/* Chart */}
      <div className="rounded-xl border border-white/10 bg-black/30 p-3" style={{ height: 380 }}>
        {buckets.length === 0 && !loading ? (
          <div className="h-full flex items-center justify-center text-white/40 text-sm">
            Aucune donnée pour cette période.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={buckets} margin={{ top: 10, right: 12, left: -8, bottom: 0 }}>
              <defs>
                {SERIES.map(({ key, color }) => (
                  <linearGradient key={key} id={`g-${key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="t"
                tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }}
                tickFormatter={(t) => formatTick(t, bucket)}
                minTickGap={20}
                stroke="rgba(255,255,255,0.1)"
              />
              <YAxis
                tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }}
                allowDecimals={false}
                stroke="rgba(255,255,255,0.1)"
                width={48}
              />
              <Tooltip content={<CustomTooltip bucket={bucket} />} />
              <Legend
                wrapperStyle={{ paddingTop: 8 }}
                iconType="circle"
                onClick={(o) => {
                  setHiddenSeries((h) => ({ ...h, [o.dataKey]: !h[o.dataKey] }));
                }}
                formatter={(value, entry) => (
                  <span
                    style={{
                      color: hiddenSeries[entry.dataKey]
                        ? "rgba(255,255,255,0.3)"
                        : entry.color,
                      fontSize: 12,
                    }}
                  >
                    {value}
                  </span>
                )}
              />
              {SERIES.map(({ key, label, color }) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={label}
                  stroke={color}
                  strokeWidth={2}
                  fill={`url(#g-${key})`}
                  hide={!!hiddenSeries[key]}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
