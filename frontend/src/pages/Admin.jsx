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
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

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

  const reloadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("id, email, role, is_vip, vip_granted_at, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      setUsers(data || []);
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
        .limit(200);
      if (error) throw new Error(error.message);
      setVipKeys(data || []);
    } catch (e) {
      toast.error(`Impossible de charger les clés VIP: ${e.message}`);
    } finally {
      setKeysLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      reloadUsers();
      reloadKeys();
    }
  }, [isAdmin, reloadUsers, reloadKeys]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => (u.email || "").toLowerCase().includes(q));
  }, [users, search]);

  const stats = useMemo(() => {
    const total = users.length;
    const admins = users.filter((u) => u.role === "admin").length;
    const vips = users.filter((u) => u.role === "vip" || u.is_vip).length;
    const members = total - admins - vips;
    const usedKeys = vipKeys.filter((k) => k.used).length;
    return { total, admins, vips, members, usedKeys, totalKeys: vipKeys.length };
  }, [users, vipKeys]);

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
          <img src="https://i.imgur.com/V8YmT4z.png" alt="LiveWatch" className="h-7" />
          <span className="hidden sm:inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.18em] text-red-400 px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/30">
            <Shield size={12} /> Admin
          </span>
          <Link to="/dashboard" className="ml-auto player-btn px-3 text-sm" data-testid="admin-dashboard-link">
            Mon Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Stats */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="admin-stats">
          {[
            { label: "Utilisateurs", value: stats.total, icon: UsersIcon, color: "text-white" },
            { label: "Admins", value: stats.admins, icon: Shield, color: "text-red-400" },
            { label: "VIP", value: stats.vips, icon: Crown, color: "text-yellow-400" },
            { label: "Clés VIP", value: `${stats.usedKeys} / ${stats.totalKeys}`, icon: KeyRound, color: "text-blue-400" },
          ].map((s) => (
            <div key={s.label} className="glass rounded-xl p-4 border border-white/10">
              <s.icon size={16} className={s.color} />
              <p className="text-2xl font-bold mt-2 tabular-nums">{s.value}</p>
              <p className="text-[11px] uppercase tracking-wider text-white/50">{s.label}</p>
            </div>
          ))}
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

        {/* Users */}
        <section className="glass-heavy rounded-2xl p-5 border border-white/10" data-testid="admin-users-section">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <UsersIcon size={18} className="text-[#ff2e63]" /> Utilisateurs ({filtered.length})
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
