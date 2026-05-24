import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import axios from "axios";
import {
  ArrowLeft,
  Heart,
  Crown,
  Shield,
  User as UserIcon,
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
import VipUpgradeModule from "@/components/VipUpgradeModule";
import TopBar from "@/components/TopBar";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || window.location.origin;
const API = `${BACKEND_URL}/api`;

export default function Dashboard() {
  const { user, profile, loading, isAdmin, isVip, role, roleLabel, roleColor, signOut, refreshProfile } = useAuth();
  const { favorites, count } = useFavorites();

  const [favChannels, setFavChannels] = useState([]);
  const [loadingChans, setLoadingChans] = useState(false);

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

  /** Returns the Authorization header for backend calls (used by VipUpgradeModule). */
  const getAuthHeader = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
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

      <TopBar
        variant="dashboard"
        backTo="/"
        right={
          <>
            {isAdmin && (
              <Link to="/admin" className="topbar-pill hidden sm:inline-flex" data-testid="dashboard-admin-link">
                <Shield size={13} />
                <span className="text-xs">Admin</span>
              </Link>
            )}
            <button onClick={handleSignOut} className="topbar-pill" data-testid="dashboard-logout-btn">
              <LogOut size={13} />
              <span className="text-xs">Déconnexion</span>
            </button>
          </>
        }
      />

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

        {/* VIP buy + redeem module (only shown to non-VIP) */}
        {!isVip && (
          <VipUpgradeModule
            getAuthHeader={getAuthHeader}
            onRedeemed={refreshProfile}
          />
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
