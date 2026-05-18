import { useState } from "react";
import { ExternalLink, ShieldCheck, Check, Lock } from "lucide-react";

const AD_URL_1 = "https://foreignabnormality.com/ktfpa1187?key=bcec92d207239b8d8e091e898bcd8666";
const AD_URL_2 = "https://omg10.com/4/10323906";

export default function AdUnlockModal({ channel, onUnlocked, onCancel }) {
  const [step, setStep] = useState(1);

  const openAd1 = () => {
    window.open(AD_URL_1, "_blank", "noopener,noreferrer");
    setStep(2);
  };
  const openAd2 = () => {
    window.open(AD_URL_2, "_blank", "noopener,noreferrer");
    onUnlocked();
  };

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
        </p>
      </div>
    </div>
  );
}
