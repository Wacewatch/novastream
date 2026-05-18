import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LogIn, LogOut, User as UserIcon, Shield, Crown, ChevronDown, LayoutDashboard, Settings } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

export default function UserMenu() {
  const { user, profile, loading, isAdmin, isVip, roleLabel, roleColor, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (loading) {
    return (
      <div className="h-9 w-9 rounded-full glass-pill animate-pulse" />
    );
  }

  if (!user) {
    return (
      <Link
        to="/login"
        className="player-btn inline-flex items-center gap-1.5 px-3"
        data-testid="login-btn"
        title="Se connecter"
      >
        <LogIn size={16} />
        <span className="hidden sm:inline text-sm">Connexion</span>
      </Link>
    );
  }

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success("Déconnecté");
    } catch (e) {
      toast.error("Erreur de déconnexion");
    }
  };

  const RoleIcon = isAdmin ? Shield : isVip ? Crown : UserIcon;
  const initials = (profile?.email || user.email || "?")
    .split("@")[0]
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-2 py-1 rounded-full glass-pill border-white/10 hover:border-white/20 transition-colors"
        data-testid="user-menu-btn"
        aria-label="Menu utilisateur"
      >
        <span
          className="flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-bold text-white"
          style={{ background: `linear-gradient(135deg, ${roleColor}, #1a1a1f)` }}
        >
          {initials}
        </span>
        <span className="hidden sm:inline-flex items-center gap-1 text-xs text-white/85">
          <RoleIcon size={12} style={{ color: roleColor }} />
          {roleLabel}
        </span>
        <ChevronDown size={14} className="text-white/50" />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-64 glass-heavy rounded-xl border border-white/10 shadow-xl py-2 z-50"
          data-testid="user-menu-dropdown"
        >
          <div className="px-3 py-2 border-b border-white/5">
            <p className="text-sm text-white font-medium truncate">
              {profile?.email || user.email}
            </p>
            <p className="text-xs mt-0.5 flex items-center gap-1" style={{ color: roleColor }}>
              <RoleIcon size={11} /> {roleLabel}
            </p>
          </div>
          <Link
            to="/dashboard"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-white/80 hover:bg-white/5"
            data-testid="menu-dashboard-link"
          >
            <LayoutDashboard size={14} /> Mon Dashboard
          </Link>
          {isAdmin && (
            <Link
              to="/admin"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-white/80 hover:bg-white/5"
              data-testid="menu-admin-link"
            >
              <Settings size={14} /> Administration
            </Link>
          )}
          <div className="border-t border-white/5 mt-1 pt-1">
            <button
              onClick={handleSignOut}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-white/80 hover:bg-white/5"
              data-testid="menu-logout-btn"
            >
              <LogOut size={14} /> Se déconnecter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
