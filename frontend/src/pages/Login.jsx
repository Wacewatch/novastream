import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, LogIn, Mail, Lock, Loader2, UserPlus } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

export default function Login() {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const from = location.state?.from?.pathname || "/";

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (mode === "signup" && password !== confirm) {
      toast.error("Les mots de passe ne correspondent pas");
      return;
    }
    if (password.length < 6) {
      toast.error("Le mot de passe doit faire au moins 6 caractères");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        await signIn(email.trim(), password);
        toast.success("Connexion réussie");
        navigate(from, { replace: true });
      } else {
        await signUp(email.trim(), password);
        toast.success("Compte créé ! Vérifiez votre email si la confirmation est activée.");
        navigate(from, { replace: true });
      }
    } catch (err) {
      toast.error(err?.message || "Erreur d'authentification");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 text-white">
      <div className="ns-bg" />
      <div className="ns-grain" />

      <Link to="/" className="absolute top-4 left-4 player-btn" data-testid="login-back-btn">
        <ArrowLeft size={18} />
      </Link>

      <div className="glass-heavy rounded-2xl p-6 sm:p-8 w-full max-w-md border border-white/10 shadow-2xl">
        <div className="flex items-center justify-center mb-6">
          <img src="https://i.imgur.com/V8YmT4z.png" alt="LiveWatch" className="h-10" />
        </div>
        <h1 className="text-2xl font-bold text-center mb-1">
          {mode === "signin" ? "Connexion" : "Créer un compte"}
        </h1>
        <p className="text-center text-white/60 text-sm mb-6">
          {mode === "signin"
            ? "Accédez à vos favoris et votre dashboard"
            : "Inscrivez-vous pour profiter de toutes les fonctionnalités"}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3" data-testid="auth-form">
          <div className="relative">
            <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="votre@email.com"
              data-testid="auth-email-input"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-[#ff2e63]/50"
            />
          </div>
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mot de passe"
              data-testid="auth-password-input"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-[#ff2e63]/50"
            />
          </div>
          {mode === "signup" && (
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
              <input
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirmer le mot de passe"
                data-testid="auth-confirm-input"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-[#ff2e63]/50"
              />
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 rounded-xl bg-[#ff2e63] hover:bg-[#ff1a52] text-white font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
            data-testid="auth-submit-btn"
          >
            {busy ? (
              <Loader2 className="animate-spin" size={16} />
            ) : mode === "signin" ? (
              <LogIn size={16} />
            ) : (
              <UserPlus size={16} />
            )}
            {mode === "signin" ? "Se connecter" : "Créer mon compte"}
          </button>
        </form>

        <p className="text-center text-sm text-white/60 mt-5">
          {mode === "signin" ? "Pas encore de compte ?" : "Déjà un compte ?"}{" "}
          <button
            onClick={() => setMode((m) => (m === "signin" ? "signup" : "signin"))}
            className="text-[#ff2e63] hover:underline font-semibold"
            data-testid="auth-toggle-mode"
          >
            {mode === "signin" ? "Créer un compte" : "Se connecter"}
          </button>
        </p>
      </div>
    </div>
  );
}
