import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import axios from "axios";
import {
  ArrowLeft,
  Heart,
  Crown,
  Shield,
  User as UserIcon,
  KeyRound,
  Loader2,
  Tv2,
  Calendar,
  LogOut,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFavorites } from "@/hooks/useFavorites";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || window.location.origin;
const API = `${BACKEND_URL}/api`;

export default function Dashboard() {
  const { user, profile, loading, isAdmin, isVip, role, roleLabel, roleColor, signOut, refreshProfile } = useAuth();
  const { favorites, count } = useFavorites();

  const [favChannels, setFavChannels] = useState([]);
  const [loadingChans, setLoadingChans] = useState(false);
  const [vipKey, setVipKey] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!favorites.length) {
        setFavChannels([]);
        return;
      }
      setLoadingChans(true);
      try {
        const r = await axios.post(`${API}/channels/by-ids`, { ids: favorites });
        if (cancelled) return;
        setFavChannels(r.data.channels || []);
      } catch (_) {
        if (cancelled) return;
        setFavChannels([]);
      } finally {
        if (!cancelled) setLoadingChans(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [favorites]);

  const memberSince = useMemo(() => {
    const d = profile?.created_at || user?.created_at;
    if (!d) return "—";
    try {
      return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    } catch (_) {
      return "—";
    }
  }, [profile, user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white">
        <Loader2 className="animate-spin" size={28} />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: { pathname: "/dashboard" } }} />;
  }

  const handleRedeem = async (e) => {
    e.preventDefault();
    if (!vipKey.trim()) return;
    setRedeeming(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const r = await axios.post(
        `${API}/auth/redeem-vip`,
        { key: vipKey.trim() },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (r.data?.success) {
        toast.success("🎉 Clé VIP activée ! Bienvenue dans le club Premium.");
        setVipKey("");
        await refreshProfile();
      } else {
        toast.error(r.data?.error || "Erreur d'activation");
      }
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.response?.data?.error || err?.message || "Erreur";
      toast.error(msg);
    } finally {
      setRedeeming(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success("Déconnecté");
    } catch (_) {
      toast.error("Erreur de déconnexion");
    }
  };

  const RoleIcon = isAdmin ? Shield : isVip ? Crown : UserIcon;

  return (
    <div className="relative min-h-screen text-white">
      <div className="ns-bg" />
      <div className="ns-grain" />

      <header className="sticky top-0 z-30 glass" style={{ borderRadius: 0 }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link to="/" className="player-btn" data-testid="dashboard-back-btn">
            <ArrowLeft size={18} />
          </Link>
          <img src="https://i.imgur.com/V8YmT4z.png" alt="LiveWatch" className="h-7" />
          <span className="hidden sm:inline-flex text-xs uppercase tracking-[0.18em] text-white/55 px-2.5 py-1 rounded-full glass-pill">
            Dashboard
          </span>
          <div className="ml-auto flex items-center gap-2">
            {isAdmin && (
              <Link to="/admin" className="player-btn inline-flex items-center gap-1.5 px-3 text-sm" data-testid="dashboard-admin-link">
                <Shield size={14} /> Admin
              </Link>
            )}
            <button onClick={handleSignOut} className="player-btn inline-flex items-center gap-1.5 px-3 text-sm" data-testid="dashboard-logout-btn">
              <LogOut size={14} /> Déconnexion
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Profile card */}
        <section className="glass-heavy rounded-2xl p-5 sm:p-6 border border-white/10" data-testid="profile-card">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center overflow-hidden border border-white/10"
              style={{ background: `linear-gradient(135deg, ${roleColor}33, #0a0a0f)` }}
            >
              <img
                src="https://i.imgur.com/V8YmT4z.png"
                alt="LiveWatch"
                className="w-10 h-10 object-contain"
                draggable={false}
              />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold truncate">{profile?.email || user.email}</h2>
              <p className="mt-1 inline-flex items-center gap-1.5 text-sm" style={{ color: roleColor }}>
                <RoleIcon size={14} /> {roleLabel}
                {isVip && !isAdmin && <Sparkles size={13} className="ml-1" />}
              </p>
              <p className="mt-2 text-xs text-white/50 inline-flex items-center gap-1">
                <Calendar size={11} /> Membre depuis {memberSince}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="glass-pill px-4 py-3 rounded-xl text-center min-w-[100px]">
                <Heart size={14} className="mx-auto text-[#ff2e63]" />
                <p className="text-xl font-bold mt-1 tabular-nums">{count}</p>
                <p className="text-[10px] uppercase tracking-wider text-white/50">Favoris</p>
              </div>
              <div className="glass-pill px-4 py-3 rounded-xl text-center min-w-[100px]">
                <Crown size={14} className="mx-auto" style={{ color: roleColor }} />
                <p className="text-xs font-bold mt-1 uppercase" style={{ color: roleColor }}>
                  {role}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-white/50">Statut</p>
              </div>
            </div>
          </div>
        </section>

        {/* VIP key redemption (only for non-VIP) */}
        {!isVip && (
          <section className="mt-6 glass rounded-2xl p-5 border border-white/10" data-testid="vip-redeem-section">
            <div className="flex items-center gap-2 mb-3">
              <Crown size={18} className="text-yellow-400" />
              <h3 className="text-lg font-bold">Activer une clé VIP</h3>
            </div>
            <p className="text-sm text-white/60 mb-4">
              Entrez votre clé VIP pour débloquer la lecture sans pub et accéder aux fonctionnalités premium.
            </p>
            <form onSubmit={handleRedeem} className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
                <input
                  value={vipKey}
                  onChange={(e) => setVipKey(e.target.value)}
                  placeholder="Ex: VIP-XXXX-XXXX-XXXX"
                  required
                  data-testid="vip-key-input"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-yellow-400/50 font-mono"
                />
              </div>
              <button
                type="submit"
                disabled={redeeming}
                className="px-5 py-2.5 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
                data-testid="vip-redeem-btn"
              >
                {redeeming ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                Activer
              </button>
            </form>
          </section>
        )}

        {/* Favorites */}
        <section className="mt-6" data-testid="favorites-section">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Heart size={18} className="text-[#ff2e63]" /> Mes chaînes favorites
              <span className="text-sm font-normal text-white/40">({count})</span>
            </h3>
            <Link to="/" className="text-sm text-[#ff2e63] hover:underline">
              + Parcourir les chaînes
            </Link>
          </div>

          {loadingChans ? (
            <div className="py-10 flex items-center justify-center">
              <Loader2 className="animate-spin text-[#ff2e63]" size={24} />
            </div>
          ) : favChannels.length === 0 ? (
            <div className="glass rounded-2xl p-8 text-center text-white/50 border border-white/10">
              <Heart size={32} className="mx-auto mb-3 text-white/20" />
              <p className="text-sm">Aucun favori pour l'instant.</p>
              <p className="text-xs mt-1">Cliquez sur le cœur d'une chaîne depuis l'accueil pour l'ajouter.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" data-testid="favorites-grid">
              {favChannels.map((c) => (
                <Link
                  key={c.id}
                  to={`/?channel=${encodeURIComponent(c.id)}`}
                  className="glass rounded-xl p-3 border border-white/10 hover:border-[#ff2e63]/40 transition-colors group"
                  data-testid={`fav-channel-${c.id}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
                      <Tv2 size={16} className="text-white/50 group-hover:text-[#ff2e63]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white truncate">{c.name}</p>
                      <p className="text-[10px] uppercase tracking-wider text-white/40 truncate">
                        {c.country}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
