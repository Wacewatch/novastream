import { useState, useEffect } from "react";
import { ExternalLink, ShieldCheck, Check, Lock, Crown, Shield, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const AD_URL_1 = "https://foreignabnormality.com/ktfpa1187?key=bcec92d207239b8d8e091e898bcd8666";
const AD_URL_2 = "https://omg10.com/4/10323906";

export default function AdUnlockModal({ channel, onUnlocked, onCancel }) {
  const [step, setStep] = useState(1);
  const [waitedTooLong, setWaitedTooLong] = useState(false);
  const { user, profile, hasAdFreeExperience, isAdmin, roleLabel, loading, refreshProfile } = useAuth();

  // Admins and VIPs bypass the ad modal entirely — auto-unlock as soon as
  // their auth/profile finished loading.
  useEffect(() => {
    if (loading) return;
    if (hasAdFreeExperience) {
      // Tiny delay so the splash isn't a jarring flash
      const t = setTimeout(() => onUnlocked(), 350);
      return () => clearTimeout(t);
    }
  }, [hasAdFreeExperience, loading, onUnlocked]);

  // Safety: if the user is logged-in but profile didn't load (RLS/etc.),
  // re-trigger a profile refresh so role-based bypass can apply.
  useEffect(() => {
    if (!loading && user && !profile) {
      refreshProfile?.();
    }
  }, [loading, user, profile, refreshProfile]);

  // Cap the loading splash at 4s — after that, fall through to ad modal
  // so a stuck profile fetch doesn't block playback indefinitely.
  useEffect(() => {
    const t = setTimeout(() => setWaitedTooLong(true), 4000);
    return () => clearTimeout(t);
  }, []);

  const openAd1 = () => {
    window.open(AD_URL_1, "_blank", "noopener,noreferrer");
    setStep(2);
  };
  const openAd2 = () => {
    window.open(AD_URL_2, "_blank", "noopener,noreferrer");
    onUnlocked();
  };

  // ===== Loading splash =====
  // While auth/profile is still resolving, OR if the user is logged-in but
  // their profile hasn't been fetched yet (RLS retry in flight), show a
  // neutral loader rather than the ad modal — avoids flashing the pub modal
  // to admins/VIPs whose role hasn't been resolved yet.
  if (!waitedTooLong && (loading || (user && !profile))) {
    return (
      <div className="player-shell" data-testid="ad-modal-loading">
        <div className="ad-modal glass-heavy">
          <div className="flex justify-center mb-4">
            <Loader2 size={28} className="animate-spin text-[#ff2e63]" />
          </div>
          <h2 className="text-white text-xl font-bold tracking-tight mb-2 text-center">
            Préparation…
          </h2>
          <p className="text-white/65 text-sm text-center">
            {channel?.name ? `${channel.name} — ` : ""}Vérification de votre statut.
          </p>
        </div>
      </div>
    );
  }

  // ===== VIP / Admin bypass splash =====
  if (hasAdFreeExperience) {
    return (
      <div className="player-shell" data-testid="ad-modal-bypass">
        <div className="ad-modal glass-heavy">
          <div className="flex justify-center mb-4">
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
              style={{
                background: isAdmin ? "rgba(239,68,68,0.15)" : "rgba(250,204,21,0.15)",
                color: isAdmin ? "#f87171" : "#facc15",
                border: `1px solid ${isAdmin ? "rgba(239,68,68,0.35)" : "rgba(250,204,21,0.35)"}`,
              }}
            >
              {isAdmin ? <Shield size={12} /> : <Crown size={12} />}
              {roleLabel}
            </span>
          </div>
          <h2 className="text-white text-2xl font-extrabold tracking-tight mb-2">
            Accès sans publicité
          </h2>
          <p className="text-white/65 text-sm leading-relaxed mb-5">
            {channel?.name ? `${channel.name} — ` : ""}Lancement du lecteur…
          </p>
          <div className="ad-progress mb-6">
            <span className="done" />
            <span className="done" />
          </div>
          <button disabled className="ad-btn-primary" data-testid="ad-bypass-loader">
            <span className="ad-check"><Check size={14} /></span>
            {isAdmin ? "Admin — Pub bypassée" : "VIP — Pub bypassée"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="player-shell" data-testid="ad-modal">
      <div className="ad-modal glass-heavy">
        <div className="flex justify-center mb-4">
          <span className="ad-step">
            <Lock size={12} /> Étape {step} / 2
          </span>
        </div>

        <h2 className="text-white text-2xl font-extrabold tracking-tight mb-2" data-testid="ad-modal-title">
          Débloquer le direct
        </h2>
        <p className="text-white/65 text-sm leading-relaxed mb-5" data-testid="ad-modal-channel">
          {channel?.name ? `${channel.name} — ` : ""}Cliquez sur les 2 boutons ci-dessous pour lancer le lecteur. (2 clics maximum)
        </p>

        <div className="ad-progress mb-6">
          <span className={step >= 1 ? "done" : ""} />
          <span className={step >= 2 ? "done" : ""} />
        </div>

        <div className="flex flex-col gap-3">
          {step === 1 ? (
            <button onClick={openAd1} className="ad-btn-primary" data-testid="ad-btn-1">
              <ExternalLink size={18} />
              Débloquer la chaîne (Pub 1)
            </button>
          ) : (
            <button disabled className="ad-btn-primary" data-testid="ad-btn-1-done">
              <span className="ad-check"><Check size={14} /></span>
              Étape 1 validée
            </button>
          )}

          {step >= 2 && (
            <button onClick={openAd2} className="ad-btn-primary" data-testid="ad-btn-2">
              <ShieldCheck size={18} />
              Lancer le lecteur (Pub 2)
            </button>
          )}

          <button onClick={onCancel} className="ad-btn-secondary" data-testid="ad-cancel-btn">
            Annuler
          </button>
        </div>

        <p className="text-white/40 text-xs mt-5">
          Les publicités s'ouvrent dans un nouvel onglet. Le direct démarre automatiquement après la 2ᵉ étape.
          <br />
          <span className="text-yellow-400/80">Astuce: un compte VIP supprime les pubs.</span>
        </p>
      </div>
    </div>
  );
}
