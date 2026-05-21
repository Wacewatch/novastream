import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import axios from "axios";
import {
  ArrowLeft,
  Crown,
  Shield,
  Users as UsersIcon,
  KeyRound,
  Plus,
  Loader2,
  Search,
  Check,
  Trash2,
  Copy,
  CalendarClock,
  Cpu,
  MemoryStick,
  Network,
  Server,
  Activity,
  Globe,
  Eye,
  Radio,
  Tv2,
  Flame,
  AlertTriangle,
  ToggleRight,
  ToggleLeft,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || window.location.origin;
const API = `${BACKEND_URL}/api`;
const SITE_LOGO = "https://i.imgur.com/V8YmT4z.png";

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export default function Admin() {
  const { user, loading, isAdmin } = useAuth();
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [vipKeys, setVipKeys] = useState([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genCount, setGenCount] = useState(5);

  // New modules state
  const [sysStats, setSysStats] = useState(null);
  const [liveStats, setLiveStats] = useState(null);
  const [referrers, setReferrers] = useState([]);
  const [globalStats, setGlobalStats] = useState(null);

  // Football API keys module
  const [fbKeys, setFbKeys] = useState([]);
  const [fbKeysLoading, setFbKeysLoading] = useState(true);
  const [fbNewKey, setFbNewKey] = useState("");
  const [fbNewLabel, setFbNewLabel] = useState("");
  const [fbAdding, setFbAdding] = useState(false);

  // DaddyTV config module
  const [daddyCfg, setDaddyCfg] = useState(null); // { enabled, channels_url, m3u8_url, channel_count, cache_age_sec, defaults }
  const [daddyCfgLoading, setDaddyCfgLoading] = useState(true);
  const [daddyForm, setDaddyForm] = useState({ channels_url: "", m3u8_url: "", enabled: true });
  const [daddyTesting, setDaddyTesting] = useState(false);
  const [daddyTestResult, setDaddyTestResult] = useState(null);
  const [daddySaving, setDaddySaving] = useState(false);

  const reloadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      // No artificial limit — fetch in chunks of 1000 until exhausted (Supabase max per query = 1000)
      const all = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("user_profiles")
          .select("id, email, role, is_vip, vip_granted_at, created_at")
          .order("created_at", { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < pageSize) break;
        if (from > 50000) break; // hard safety cap
      }
      setUsers(all);
    } catch (e) {
      toast.error(`Impossible de charger les utilisateurs: ${e.message}`);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const reloadKeys = useCallback(async () => {
    setKeysLoading(true);
    try {
      const { data, error } = await supabase
        .from("vip_keys")
        .select("id, key, used, used_by, used_at, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      setVipKeys(data || []);
    } catch (e) {
      toast.error(`Impossible de charger les clés VIP: ${e.message}`);
    } finally {
      setKeysLoading(false);
    }
  }, []);

  const fetchAdminStats = useCallback(async () => {
    try {
      const headers = await authHeader();
      const [sys, live, ref, glob] = await Promise.all([
        axios.get(`${API}/admin/system-stats`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/admin/live-stats`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/admin/top-referrers?hours=24&limit=10`, { headers }).catch(() => ({ data: { referrers: [] } })),
        axios.get(`${API}/admin/global-stats`, { headers }).catch(() => ({ data: null })),
      ]);
      if (sys.data) setSysStats(sys.data);
      if (live.data) setLiveStats(live.data);
      setReferrers(ref.data?.referrers || []);
      if (glob.data) setGlobalStats(glob.data);
    } catch (_) {
      /* silent */
    }
  }, []);

  // ========== Football API Keys ==========
  const reloadFbKeys = useCallback(async () => {
    setFbKeysLoading(true);
    try {
      const headers = await authHeader();
      const r = await axios.get(`${API}/admin/football-keys`, { headers });
      setFbKeys(r.data?.keys || []);
    } catch (e) {
      toast.error(`Football API: ${e.response?.data?.detail || e.message}`);
    } finally {
      setFbKeysLoading(false);
    }
  }, []);

  const addFbKey = async (e) => {
    e?.preventDefault?.();
    const key = fbNewKey.trim();
    if (key.length < 20) {
      toast.error("Clé invalide (min. 20 caractères)");
      return;
    }
    setFbAdding(true);
    try {
      const headers = await authHeader();
      await axios.post(
        `${API}/admin/football-keys`,
        { api_key: key, label: fbNewLabel.trim() || null, enabled: true },
        { headers },
      );
      setFbNewKey("");
      setFbNewLabel("");
      toast.success("Clé RapidAPI ajoutée");
      await reloadFbKeys();
    } catch (err) {
      toast.error(`Échec: ${err.response?.data?.detail || err.message}`);
    } finally {
      setFbAdding(false);
    }
  };

  const toggleFbKey = async (k) => {
    try {
      const headers = await authHeader();
      await axios.patch(
        `${API}/admin/football-keys/${k.id}`,
        { enabled: !k.enabled },
        { headers },
      );
      await reloadFbKeys();
    } catch (err) {
      toast.error(`Échec: ${err.response?.data?.detail || err.message}`);
    }
  };

  const deleteFbKey = async (id) => {
    if (!window.confirm("Supprimer cette clé RapidAPI ?")) return;
    try {
      const headers = await authHeader();
      await axios.delete(`${API}/admin/football-keys/${id}`, { headers });
      toast.success("Clé supprimée");
      await reloadFbKeys();
    } catch (err) {
      toast.error(`Échec: ${err.response?.data?.detail || err.message}`);
    }
  };

  // ========== DaddyTV config ==========
  const reloadDaddyCfg = useCallback(async () => {
    setDaddyCfgLoading(true);
    try {
      const headers = await authHeader();
      const r = await axios.get(`${API}/admin/daddy/config`, { headers });
      setDaddyCfg(r.data);
      setDaddyForm({
        channels_url: r.data?.channels_url || "",
        m3u8_url: r.data?.m3u8_url || "",
        enabled: !!r.data?.enabled,
      });
    } catch (e) {
      toast.error(`DaddyTV config: ${e.response?.data?.detail || e.message}`);
    } finally {
      setDaddyCfgLoading(false);
    }
  }, []);

  const testDaddyCfg = async () => {
    setDaddyTesting(true);
    setDaddyTestResult(null);
    try {
      const headers = await authHeader();
      const r = await axios.post(`${API}/admin/daddy/test`, daddyForm, { headers });
      setDaddyTestResult(r.data);
      if (r.data?.matched > 0) {
        toast.success(`Test OK — ${r.data.matched} chaînes appariées`);
      } else {
        toast.warning("Test : aucune chaîne appariée");
      }
    } catch (e) {
      toast.error(`Test échoué: ${e.response?.data?.detail || e.message}`);
    } finally {
      setDaddyTesting(false);
    }
  };

  const saveDaddyCfg = async () => {
    setDaddySaving(true);
    try {
      const headers = await authHeader();
      const r = await axios.patch(`${API}/admin/daddy/config`, daddyForm, { headers });
      toast.success(`Configuration enregistrée — ${r.data?.channel_count || 0} chaînes actives`);
      await reloadDaddyCfg();
    } catch (e) {
      toast.error(`Échec: ${e.response?.data?.detail || e.message}`);
    } finally {
      setDaddySaving(false);
    }
  };

  const resetDaddyDefaults = () => {
    const def = daddyCfg?.defaults || {};
    setDaddyForm({
      channels_url: def.channels_url || "",
      m3u8_url: def.m3u8_url || "",
      enabled: true,
    });
    toast.message("Valeurs par défaut restaurées (non encore sauvegardées)");
  };


  useEffect(() => {
    if (!isAdmin) return;
    reloadUsers();
    reloadKeys();
    reloadFbKeys();
    reloadDaddyCfg();
    fetchAdminStats();
    // Poll system/live stats every 5s
    const t = setInterval(fetchAdminStats, 5000);
    return () => clearInterval(t);
  }, [isAdmin, reloadUsers, reloadKeys, reloadFbKeys, reloadDaddyCfg, fetchAdminStats]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => (u.email || "").toLowerCase().includes(q));
  }, [users, search]);

  const stats = useMemo(() => {
    const total = globalStats?.total_users ?? users.length;
    const admins = globalStats?.admins ?? users.filter((u) => u.role === "admin").length;
    const vips = globalStats?.vips ?? users.filter((u) => u.role === "vip" || u.is_vip).length;
    const usedKeys = vipKeys.filter((k) => k.used).length;
    return {
      total,
      admins,
      vips,
      usedKeys,
      totalKeys: vipKeys.length,
      channels: globalStats?.total_channels ?? 0,
    };
  }, [users, vipKeys, globalStats]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white">
        <Loader2 className="animate-spin" size={28} />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: { pathname: "/admin" } }} />;
  }
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-white px-4">
        <div className="ns-bg" />
        <Shield size={48} className="text-red-500 mb-4" />
        <h1 className="text-2xl font-bold mb-2">Accès refusé</h1>
        <p className="text-white/60 text-sm mb-6">Vous devez être administrateur pour accéder à cette page.</p>
        <Link to="/" className="player-btn px-4 py-2">Retour</Link>
      </div>
    );
  }

  const setUserRole = async (u, newRole) => {
    const updates = newRole === "vip"
      ? { role: "vip", is_vip: true, vip_granted_at: new Date().toISOString() }
      : newRole === "admin"
      ? { role: "admin" }
      : { role: "member", is_vip: false, vip_granted_at: null };
    try {
      const { error } = await supabase.from("user_profiles").update(updates).eq("id", u.id);
      if (error) throw new Error(error.message);
      toast.success(`Rôle mis à jour: ${newRole}`);
      await reloadUsers();
    } catch (e) {
      toast.error(`Échec: ${e.message}`);
    }
  };

  const generateKeys = async (e) => {
    e.preventDefault();
    if (generating) return;
    setGenerating(true);
    try {
      const headers = await authHeader();
      const r = await axios.post(`${API}/admin/vip-keys/generate`, { count: Number(genCount) }, { headers });
      toast.success(`${r.data.created} clé(s) VIP générée(s)`);
      await reloadKeys();
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || "Erreur";
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  };

  const deleteKey = async (id) => {
    if (!window.confirm("Supprimer cette clé ?")) return;
    try {
      const { error } = await supabase.from("vip_keys").delete().eq("id", id);
      if (error) throw new Error(error.message);
      toast.success("Clé supprimée");
      await reloadKeys();
    } catch (e) {
      toast.error(`Échec: ${e.message}`);
    }
  };

  const copyKey = (k) => {
    navigator.clipboard?.writeText(k).then(() => toast.success("Clé copiée"));
  };

  return (
    <div className="relative min-h-screen text-white">
      <div className="ns-bg" />
      <div className="ns-grain" />

      <header className="sticky top-0 z-30 glass" style={{ borderRadius: 0 }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link to="/" className="player-btn" data-testid="admin-back-btn">
            <ArrowLeft size={18} />
          </Link>
          <img src={SITE_LOGO} alt="LiveWatch" className="h-7" />
          <span className="hidden sm:inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.18em] text-red-400 px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/30">
            <Shield size={12} /> Admin
          </span>
          <Link to="/dashboard" className="ml-auto player-btn px-3 text-sm" data-testid="admin-dashboard-link">
            Mon Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Global Stats cards */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" data-testid="admin-stats">
          {[
            { label: "Utilisateurs", value: stats.total.toLocaleString("fr-FR"), icon: UsersIcon, color: "text-white" },
            { label: "Admins", value: stats.admins, icon: Shield, color: "text-red-400" },
            { label: "VIP", value: stats.vips, icon: Crown, color: "text-yellow-400" },
            { label: "Chaînes", value: stats.channels.toLocaleString("fr-FR"), icon: Tv2, color: "text-pink-400" },
            { label: "Clés VIP", value: `${stats.usedKeys} / ${stats.totalKeys}`, icon: KeyRound, color: "text-blue-400" },
          ].map((s) => (
            <div key={s.label} className="glass rounded-xl p-4 border border-white/10" data-testid={`admin-stat-${s.label.toLowerCase()}`}>
              <s.icon size={16} className={s.color} />
              <p className="text-2xl font-bold mt-2 tabular-nums">{s.value}</p>
              <p className="text-[11px] uppercase tracking-wider text-white/50">{s.label}</p>
            </div>
          ))}
        </section>

        {/* System stats: CPU / RAM / Network / System */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" data-testid="admin-system-stats">
          <SystemCard
            title="CPU App"
            icon={Cpu}
            iconColor="text-yellow-400"
            primary={sysStats ? `${sysStats.cpu_percent.toFixed(1)}%` : "—"}
            barPct={sysStats?.cpu_percent || 0}
            barColor="bg-yellow-400"
            sub="FastAPI Process"
            testid="sys-card-cpu"
          />
          <SystemCard
            title="RAM App"
            icon={MemoryStick}
            iconColor="text-pink-400"
            primary={sysStats ? `${sysStats.system_mem_percent.toFixed(1)}%` : "—"}
            barPct={sysStats?.system_mem_percent || 0}
            barColor="bg-pink-400"
            sub={sysStats ? `${sysStats.process_mem_mb.toFixed(1)} MB / ${sysStats.total_mem_mb.toFixed(0)} MB` : "—"}
            testid="sys-card-ram"
          />
          <div className="glass rounded-xl p-4 border border-white/10" data-testid="sys-card-network">
            <div className="flex items-center gap-2 mb-3 text-cyan-400">
              <Network size={14} />
              <span className="text-[11px] uppercase tracking-wider">Réseau</span>
            </div>
            <p className="text-[11px] text-white/40 uppercase tracking-wider mb-2">En direct</p>
            <div className="flex items-end gap-3">
              <div>
                <p className="text-2xl font-bold tabular-nums">{liveStats?.online ?? 0}</p>
                <p className="text-[10px] text-white/50 uppercase tracking-wider">En ligne</p>
              </div>
              <div className="ml-auto">
                <p className="text-xl font-semibold tabular-nums text-cyan-400">{liveStats?.total_24h ?? 0}</p>
                <p className="text-[10px] text-white/50 uppercase tracking-wider">/ 24 h</p>
              </div>
            </div>
          </div>
          <div className="glass rounded-xl p-4 border border-white/10" data-testid="sys-card-system">
            <div className="flex items-center gap-2 mb-3 text-blue-400">
              <Server size={14} />
              <span className="text-[11px] uppercase tracking-wider">Système</span>
            </div>
            <div className="space-y-1.5 text-sm">
              <Row k="Uptime" v={sysStats?.uptime || "—"} />
              <Row k="Platform" v={sysStats?.platform || "—"} />
              <Row k="Python" v={sysStats?.python_version || "—"} />
            </div>
          </div>
        </section>

        {/* Statistiques en direct */}
        <section className="glass-heavy rounded-2xl p-5 border border-white/10" data-testid="admin-live-section">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Activity size={18} className="text-green-400" /> Statistiques en direct
              <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-green-400 px-2 py-0.5 rounded-full bg-green-500/10">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> LIVE
              </span>
            </h3>
            <span className="text-xs text-white/40">
              {liveStats?.online ?? 0} en ligne · {liveStats?.watching ?? 0} en visionnage
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* En ligne */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5" data-testid="live-online">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-green-400">
                  <Activity size={14} />
                  <span className="text-[11px] uppercase tracking-wider">En ligne</span>
                </div>
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-green-400 px-2 py-0.5 rounded-full bg-green-500/10">
                  Live
                </span>
              </div>
              <p className="text-5xl font-extrabold text-green-400 tabular-nums">{liveStats?.online ?? 0}</p>
              <div className="mt-4 pt-4 border-t border-white/5 text-xs space-y-1">
                <div className="flex justify-between text-white/50">
                  <span>Membres :</span>
                  <span className="text-white/80 tabular-nums">0</span>
                </div>
                <div className="flex justify-between text-white/50">
                  <span>Invités :</span>
                  <span className="text-white/80 tabular-nums">{liveStats?.online ?? 0}</span>
                </div>
              </div>
            </div>

            {/* En visionnage */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5" data-testid="live-watching">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-purple-400">
                  <Eye size={14} />
                  <span className="text-[11px] uppercase tracking-wider">En visionnage</span>
                </div>
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-purple-400 px-2 py-0.5 rounded-full bg-purple-500/10">
                  Live
                </span>
              </div>
              <p className="text-5xl font-extrabold text-purple-400 tabular-nums">{liveStats?.watching ?? 0}</p>
              <p className="text-xs text-white/50 mt-4 pt-4 border-t border-white/5">regardent maintenant</p>
            </div>

            {/* Top Chaînes en Direct */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5" data-testid="live-top-channels">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-orange-400">
                  <Radio size={14} />
                  <span className="text-[11px] uppercase tracking-wider">Top Chaînes en Direct</span>
                </div>
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-orange-400 px-2 py-0.5 rounded-full bg-orange-500/10">
                  Live
                </span>
              </div>
              {liveStats?.top_channels?.length ? (
                <ol className="space-y-1.5 text-sm">
                  {liveStats.top_channels.slice(0, 5).map((c, i) => (
                    <li key={c.id} className="flex items-center justify-between" data-testid={`top-ch-${i}`}>
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="text-white/40 text-xs tabular-nums w-5">#{i + 1}</span>
                        <span className="text-white truncate">{c.name}</span>
                      </span>
                      <span className="text-orange-400 tabular-nums text-xs flex items-center gap-1">
                        {c.viewers} <Activity size={10} />
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-white/40 mt-4">Aucun visionnage actif.</p>
              )}
            </div>
          </div>
        </section>

        {/* Top Référents */}
        <section className="glass-heavy rounded-2xl p-5 border border-white/10" data-testid="admin-referrers-section">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Globe size={18} className="text-cyan-400" /> Top Référents
              <span className="text-sm font-normal text-white/40">/ 24 h</span>
            </h3>
            <span className="text-xs text-white/40">{referrers.length} source(s)</span>
          </div>
          {referrers.length === 0 ? (
            <p className="text-sm text-white/50 text-center py-4">Aucun référent enregistré pour l'instant.</p>
          ) : (
            <ol className="space-y-2" data-testid="referrers-list">
              {referrers.map((r, i) => {
                const max = referrers[0]?.count || 1;
                const pct = (r.count / max) * 100;
                return (
                  <li key={r.host} className="relative" data-testid={`referrer-${i}`}>
                    <div
                      className="absolute inset-0 rounded-lg bg-cyan-400/10"
                      style={{ width: `${pct}%`, transition: "width .3s" }}
                    />
                    <div className="relative flex items-center justify-between px-3 py-2 text-sm">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="text-white/40 text-xs tabular-nums w-5">#{i + 1}</span>
                        <Globe size={12} className="text-cyan-400 shrink-0" />
                        <span className="text-white truncate">{r.host}</span>
                      </span>
                      <span className="text-cyan-400 tabular-nums font-semibold ml-3">{r.count.toLocaleString("fr-FR")}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* VIP keys */}
        <section className="glass-heavy rounded-2xl p-5 border border-white/10" data-testid="admin-vip-keys-section">
          <div className="flex items-center justify-between mb-3 gap-2">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <KeyRound size={18} className="text-yellow-400" /> Clés VIP
            </h3>
            <form onSubmit={generateKeys} className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={50}
                value={genCount}
                onChange={(e) => setGenCount(e.target.value)}
                className="w-16 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white text-center"
                data-testid="admin-gen-count"
              />
              <button
                type="submit"
                disabled={generating}
                className="px-3 py-1.5 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-black font-semibold flex items-center gap-1.5 text-sm disabled:opacity-60"
                data-testid="admin-generate-btn"
              >
                {generating ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />}
                Générer
              </button>
            </form>
          </div>

          {keysLoading ? (
            <div className="py-6 flex items-center justify-center">
              <Loader2 className="animate-spin text-yellow-400" size={20} />
            </div>
          ) : vipKeys.length === 0 ? (
            <p className="text-white/50 text-sm text-center py-6">Aucune clé VIP pour l'instant.</p>
          ) : (
            <div className="max-h-[300px] overflow-y-auto pr-1">
              <table className="w-full text-sm" data-testid="admin-keys-table">
                <thead className="text-white/50 text-xs uppercase tracking-wider sticky top-0 bg-[#0e0e14]">
                  <tr>
                    <th className="text-left py-2 px-2">Clé</th>
                    <th className="text-center py-2 px-2">Statut</th>
                    <th className="text-left py-2 px-2 hidden sm:table-cell">Créée</th>
                    <th className="text-right py-2 px-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {vipKeys.map((k) => (
                    <tr key={k.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                      <td className="py-2 px-2 font-mono text-xs text-yellow-300">{k.key}</td>
                      <td className="py-2 px-2 text-center">
                        {k.used ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 text-xs">
                            <Check size={11} /> utilisée
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 text-xs">
                            disponible
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-xs text-white/50 hidden sm:table-cell">
                        {k.created_at ? new Date(k.created_at).toLocaleDateString("fr-FR") : "-"}
                      </td>
                      <td className="py-2 px-2 text-right">
                        <button onClick={() => copyKey(k.key)} className="player-btn w-7 h-7" title="Copier">
                          <Copy size={12} />
                        </button>
                        {!k.used && (
                          <button
                            onClick={() => deleteKey(k.id)}
                            className="player-btn w-7 h-7 ml-1 hover:bg-red-500/20"
                            title="Supprimer"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Football API Keys (RapidAPI) */}
        <section className="glass-heavy rounded-2xl p-5 border border-white/10" data-testid="admin-fb-keys-section">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Flame size={18} className="text-orange-400" /> Clés RapidAPI Football
              <span className="text-sm font-normal text-white/40">({fbKeys.length})</span>
            </h3>
            <span className="text-xs text-white/45">
              Table Supabase <code className="text-orange-300/80">football_api_keys</code>
            </span>
          </div>

          <form onSubmit={addFbKey} className="flex flex-col sm:flex-row gap-2 mb-4">
            <input
              value={fbNewKey}
              onChange={(e) => setFbNewKey(e.target.value)}
              placeholder="Nouvelle clé X-RapidAPI-Key (ex: 593cf48882msh…)"
              className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-orange-400/40 font-mono"
              data-testid="fb-new-key"
            />
            <input
              value={fbNewLabel}
              onChange={(e) => setFbNewLabel(e.target.value)}
              placeholder="Libellé (optionnel)"
              className="sm:w-44 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-orange-400/40"
              data-testid="fb-new-label"
              maxLength={60}
            />
            <button
              type="submit"
              disabled={fbAdding}
              className="px-3 py-2 rounded-lg bg-orange-400 hover:bg-orange-300 text-black font-semibold flex items-center justify-center gap-1.5 text-sm disabled:opacity-60"
              data-testid="fb-add-btn"
            >
              {fbAdding ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />}
              Ajouter
            </button>
          </form>

          {fbKeysLoading ? (
            <div className="py-6 flex items-center justify-center">
              <Loader2 className="animate-spin text-orange-400" size={20} />
            </div>
          ) : fbKeys.length === 0 ? (
            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 text-sm text-yellow-300/90 flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <div>
                Aucune clé RapidAPI configurée. Football Live utilise actuellement les clés fallback statiques (quota limité).
                Ajoutez votre propre clé sur{" "}
                <a
                  href="https://rapidapi.com/Yewale/api/football-live-streaming-api"
                  target="_blank"
                  rel="noreferrer"
                  className="underline text-orange-300"
                >
                  rapidapi.com/Yewale/api/football-live-streaming-api
                </a>.
              </div>
            </div>
          ) : (
            <div className="max-h-[360px] overflow-y-auto pr-1">
              <table className="w-full text-sm" data-testid="fb-keys-table">
                <thead className="text-white/50 text-xs uppercase tracking-wider sticky top-0 bg-[#0e0e14]">
                  <tr>
                    <th className="text-left py-2 px-2">Clé</th>
                    <th className="text-left py-2 px-2 hidden md:table-cell">Libellé</th>
                    <th className="text-center py-2 px-2">Statut</th>
                    <th className="text-center py-2 px-2 hidden sm:table-cell">Succès / Erreurs</th>
                    <th className="text-left py-2 px-2 hidden lg:table-cell">Dernier usage</th>
                    <th className="text-right py-2 px-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {fbKeys.map((k) => (
                    <tr key={k.id} className="border-t border-white/5 hover:bg-white/[0.02]" data-testid={`fb-row-${k.id}`}>
                      <td className="py-2 px-2 font-mono text-xs text-orange-300/90">{k.api_key_masked}</td>
                      <td className="py-2 px-2 text-xs text-white/70 hidden md:table-cell">{k.label || "—"}</td>
                      <td className="py-2 px-2 text-center">
                        {k.banned_today ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 text-xs" title={k.banned_reason || ""}>
                            <AlertTriangle size={11} /> banni 24h
                          </span>
                        ) : k.enabled ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 text-xs">
                            <Check size={11} /> activée
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 text-white/50 text-xs">
                            désactivée
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-center text-xs hidden sm:table-cell">
                        <span className="text-green-400 font-semibold">{k.success_count}</span>
                        <span className="text-white/30"> / </span>
                        <span className="text-red-400 font-semibold">{k.error_count}</span>
                      </td>
                      <td className="py-2 px-2 text-xs text-white/50 hidden lg:table-cell">
                        {k.last_used_at ? new Date(k.last_used_at).toLocaleString("fr-FR") : "—"}
                        {k.last_error && (
                          <div className="text-red-400/80 truncate max-w-[200px]" title={k.last_error}>
                            ⚠ {k.last_error}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right whitespace-nowrap">
                        <button
                          onClick={() => toggleFbKey(k)}
                          className="player-btn w-7 h-7"
                          title={k.enabled ? "Désactiver" : "Activer"}
                          data-testid={`fb-toggle-${k.id}`}
                        >
                          {k.enabled ? <ToggleRight size={14} className="text-green-400" /> : <ToggleLeft size={14} className="text-white/50" />}
                        </button>
                        <button
                          onClick={() => deleteFbKey(k.id)}
                          className="player-btn w-7 h-7 ml-1 hover:bg-red-500/20"
                          title="Supprimer"
                          data-testid={`fb-del-${k.id}`}
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* DaddyTV configuration */}
        <section className="glass-heavy rounded-2xl p-5 border border-white/10" data-testid="admin-daddy-section">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Radio size={18} className="text-[#ff8a00]" /> Configuration DaddyTV
              {daddyCfg && (
                <span className="text-sm font-normal text-white/40">
                  ({daddyCfg.channel_count || 0} chaînes · cache {daddyCfg.cache_age_sec || 0}s)
                </span>
              )}
            </h3>
            <button
              type="button"
              onClick={() => setDaddyForm((f) => ({ ...f, enabled: !f.enabled }))}
              className="text-sm flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:border-[#ff8a00]/40"
              data-testid="daddy-toggle-enabled"
            >
              {daddyForm.enabled ? (
                <ToggleRight size={16} className="text-green-400" />
              ) : (
                <ToggleLeft size={16} className="text-white/50" />
              )}
              {daddyForm.enabled ? "Activée" : "Désactivée"}
            </button>
          </div>

          {daddyCfgLoading ? (
            <div className="py-8 flex items-center justify-center">
              <Loader2 className="animate-spin text-[#ff8a00]" size={20} />
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs uppercase tracking-wider text-white/50 mb-1 block">
                  URL JSON des chaînes
                </label>
                <input
                  value={daddyForm.channels_url}
                  onChange={(e) => setDaddyForm({ ...daddyForm, channels_url: e.target.value })}
                  placeholder="https://daddylive.li/player/player10.json"
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#ff8a00]/40 font-mono"
                  data-testid="daddy-channels-url"
                />
                <div className="text-[11px] text-white/40 mt-1">
                  Source primaire — liste des chaînes (id, nom). Défaut : <code>{daddyCfg?.defaults?.channels_url}</code>
                </div>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wider text-white/50 mb-1 block">
                  URL JSON des flux m3u8
                </label>
                <input
                  value={daddyForm.m3u8_url}
                  onChange={(e) => setDaddyForm({ ...daddyForm, m3u8_url: e.target.value })}
                  placeholder="https://player.cfbu247.sbs/allchannel.json"
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#ff8a00]/40 font-mono"
                  data-testid="daddy-m3u8-url"
                />
                <div className="text-[11px] text-white/40 mt-1">
                  Source m3u8 — par chaîne id. Défaut : <code>{daddyCfg?.defaults?.m3u8_url}</code>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  onClick={testDaddyCfg}
                  disabled={daddyTesting}
                  className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:border-[#ff8a00]/40 text-sm flex items-center gap-1.5 disabled:opacity-60"
                  data-testid="daddy-test-btn"
                >
                  {daddyTesting ? <Loader2 className="animate-spin" size={14} /> : <Activity size={14} />}
                  Tester
                </button>
                <button
                  onClick={resetDaddyDefaults}
                  className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:border-white/20 text-sm flex items-center gap-1.5"
                  data-testid="daddy-reset-btn"
                >
                  Restaurer défauts
                </button>
                <button
                  onClick={saveDaddyCfg}
                  disabled={daddySaving}
                  className="ml-auto px-3 py-2 rounded-lg bg-[#ff8a00] hover:bg-[#ff9a20] text-black font-semibold flex items-center gap-1.5 text-sm disabled:opacity-60"
                  data-testid="daddy-save-btn"
                >
                  {daddySaving ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}
                  Enregistrer
                </button>
              </div>

              {daddyTestResult && (
                <div className="mt-3 glass rounded-xl p-3 text-xs space-y-1" data-testid="daddy-test-result">
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      Channels JSON : {daddyTestResult.channels_ok ? (
                        <span className="text-green-400 font-semibold">OK</span>
                      ) : (
                        <span className="text-red-400 font-semibold">KO</span>
                      )} ({daddyTestResult.channels_total} entrées)
                    </span>
                    <span>
                      M3U8 JSON : {daddyTestResult.m3u8_ok ? (
                        <span className="text-green-400 font-semibold">OK</span>
                      ) : (
                        <span className="text-red-400 font-semibold">KO</span>
                      )} ({daddyTestResult.m3u8_total} entrées)
                    </span>
                    <span>
                      Appariées : <span className="font-bold text-[#ff8a00]">{daddyTestResult.matched}</span>
                    </span>
                  </div>
                  {daddyTestResult.sample_channel && (
                    <div className="text-white/60 truncate">
                      Ex. chaîne : <code>#{daddyTestResult.sample_channel.id}</code> {daddyTestResult.sample_channel.name}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Users */}

        <section className="glass-heavy rounded-2xl p-5 border border-white/10" data-testid="admin-users-section">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <UsersIcon size={18} className="text-[#ff2e63]" /> Utilisateurs ({filtered.length.toLocaleString("fr-FR")})
            </h3>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher par email..."
                className="pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-white/40 w-56 focus:outline-none focus:border-white/20"
                data-testid="admin-users-search"
              />
            </div>
          </div>

          {usersLoading ? (
            <div className="py-8 flex items-center justify-center">
              <Loader2 className="animate-spin text-[#ff2e63]" size={20} />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-white/50 text-sm text-center py-6">Aucun utilisateur trouvé.</p>
          ) : (
            <div className="max-h-[500px] overflow-y-auto pr-1">
              <table className="w-full text-sm" data-testid="admin-users-table">
                <thead className="text-white/50 text-xs uppercase tracking-wider sticky top-0 bg-[#0e0e14]">
                  <tr>
                    <th className="text-left py-2 px-2">Email</th>
                    <th className="text-center py-2 px-2">Rôle</th>
                    <th className="text-left py-2 px-2 hidden sm:table-cell">Inscrit le</th>
                    <th className="text-right py-2 px-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => {
                    const role = u.role === "admin" ? "admin" : (u.role === "vip" || u.is_vip) ? "vip" : "member";
                    return (
                      <tr key={u.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                        <td className="py-2 px-2 truncate max-w-[200px]">{u.email || "—"}</td>
                        <td className="py-2 px-2 text-center">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                              role === "admin"
                                ? "bg-red-500/15 text-red-400"
                                : role === "vip"
                                ? "bg-yellow-500/15 text-yellow-400"
                                : "bg-blue-500/15 text-blue-400"
                            }`}
                          >
                            {role === "admin" ? <Shield size={10} /> : role === "vip" ? <Crown size={10} /> : null}
                            {role}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-xs text-white/50 hidden sm:table-cell">
                          <CalendarClock size={10} className="inline mr-1" />
                          {u.created_at ? new Date(u.created_at).toLocaleDateString("fr-FR") : "-"}
                        </td>
                        <td className="py-2 px-2 text-right space-x-1">
                          <button
                            disabled={role === "member"}
                            onClick={() => setUserRole(u, "member")}
                            className="px-2 py-1 rounded-md text-xs bg-blue-500/10 hover:bg-blue-500/20 disabled:opacity-30 disabled:cursor-not-allowed"
                            data-testid={`admin-set-member-${u.id}`}
                          >
                            Member
                          </button>
                          <button
                            disabled={role === "vip"}
                            onClick={() => setUserRole(u, "vip")}
                            className="px-2 py-1 rounded-md text-xs bg-yellow-500/10 hover:bg-yellow-500/20 disabled:opacity-30 disabled:cursor-not-allowed"
                            data-testid={`admin-set-vip-${u.id}`}
                          >
                            VIP
                          </button>
                          <button
                            disabled={role === "admin" || u.id === user.id}
                            onClick={() => setUserRole(u, "admin")}
                            className="px-2 py-1 rounded-md text-xs bg-red-500/10 hover:bg-red-500/20 disabled:opacity-30 disabled:cursor-not-allowed"
                            data-testid={`admin-set-admin-${u.id}`}
                          >
                            Admin
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function SystemCard({ title, icon: Icon, iconColor, primary, barPct, barColor, sub, testid }) {
  return (
    <div className="glass rounded-xl p-4 border border-white/10" data-testid={testid}>
      <div className="flex items-center gap-2 mb-3" style={{}}>
        <Icon size={14} className={iconColor} />
        <span className={`text-[11px] uppercase tracking-wider ${iconColor}`}>{title}</span>
      </div>
      <p className="text-3xl font-bold tabular-nums">{primary}</p>
      <div className="mt-3 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all`}
          style={{ width: `${Math.min(100, Math.max(0, barPct))}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] text-white/40 truncate">{sub}</p>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-white/50 text-xs uppercase tracking-wider">{k}:</span>
      <span className="text-white text-sm truncate text-right">{v}</span>
    </div>
  );
}
