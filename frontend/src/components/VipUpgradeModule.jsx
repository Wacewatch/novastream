import { useState } from "react";
import {
  Crown, Sparkles, ExternalLink, Check, KeyRound, Loader2, ShieldCheck,
  Zap, Tv2,
} from "lucide-react";
import axios from "axios";
import { toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// One-time VIP pricing & purchase URL (Ko-fi). Change this constant if you
// switch payment processor.
const VIP_PRICE = "5 €";
const VIP_BILLING = "à vie";
const VIP_BUY_URL = "https://ko-fi.com/wavewatch";

const BENEFITS = [
  {
    Icon: ShieldCheck,
    title: "Aucune publicité",
    desc: "Lecture sans interruption, partout sur LiveWatch.",
  },
  {
    Icon: Zap,
    title: "Lecture instantanée",
    desc: "Accès direct sans pub à débloquer.",
  },
  {
    Icon: Tv2,
    title: "Toutes les qualités",
    desc: "SD, HD, FHD et 4K disponibles.",
  },
  {
    Icon: Crown,
    title: "Accès à vie",
    desc: "Un seul paiement, accès illimité aux services.",
  },
];

/**
 * Combined "Become VIP" + "Redeem VIP Key" module.
 *
 * Props:
 *   - getAuthHeader: async () => ({ Authorization: "Bearer ..."}) — Supabase JWT
 *   - onRedeemed: () => void — called after a successful redeem (to refresh
 *                              the user profile in the parent)
 */
export default function VipUpgradeModule({ getAuthHeader, onRedeemed }) {
  const [vipKey, setVipKey] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  const handleRedeem = async (e) => {
    e.preventDefault();
    if (!vipKey.trim()) return;
    setRedeeming(true);
    try {
      const headers = await getAuthHeader();
      const r = await axios.post(
        `${API}/auth/redeem-vip`,
        { key: vipKey.trim() },
        { headers },
      );
      if (r.data?.success) {
        toast.success("🎉 Clé VIP activée ! Bienvenue dans le club Premium.");
        setVipKey("");
        if (onRedeemed) await onRedeemed();
      } else {
        toast.error(r.data?.error || "Clé invalide ou déjà utilisée");
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || "Erreur lors de l'activation");
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <section
      className="mt-6 grid grid-cols-1 lg:grid-cols-5 gap-4"
      data-testid="vip-upgrade-module"
    >
      {/* === Buy card (3/5 width on desktop) === */}
      <div
        className="lg:col-span-3 relative overflow-hidden rounded-2xl border border-yellow-400/30 bg-gradient-to-br from-yellow-500/10 via-amber-500/5 to-zinc-900/40 p-5 sm:p-6"
        data-testid="vip-buy-card"
      >
        {/* Decorative glow */}
        <div className="pointer-events-none absolute -top-20 -right-20 h-60 w-60 rounded-full bg-yellow-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-44 w-44 rounded-full bg-amber-500/10 blur-3xl" />

        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            <Crown size={20} className="text-yellow-400" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-yellow-300/90 font-semibold">
              Devenez VIP
            </span>
          </div>
          <h3 className="text-2xl sm:text-3xl font-extrabold text-white mb-1">
            Profitez d'une expérience{" "}
            <span className="bg-gradient-to-r from-yellow-300 to-amber-400 text-transparent bg-clip-text">
              sans publicité
            </span>
          </h3>
          <p className="text-sm text-white/60 mb-5">
            Un paiement unique, un accès à vie à tout LiveWatch.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
            {BENEFITS.map(({ Icon, title, desc }) => (
              <div
                key={title}
                className="flex items-start gap-2.5 rounded-xl bg-black/30 border border-white/5 px-3 py-2.5"
              >
                <span className="shrink-0 w-7 h-7 rounded-lg bg-yellow-400/15 text-yellow-300 flex items-center justify-center">
                  <Icon size={14} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white leading-tight">{title}</p>
                  <p className="text-[11px] text-white/50 mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-white/50">
                Prix unique
              </p>
              <p className="text-4xl sm:text-5xl font-extrabold text-white">
                {VIP_PRICE}
                <span className="ml-2 text-sm font-medium text-yellow-300/90">
                  {VIP_BILLING}
                </span>
              </p>
            </div>
            <a
              href={VIP_BUY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-yellow-400 to-amber-400 hover:from-yellow-300 hover:to-amber-300 text-black font-bold shadow-lg shadow-yellow-500/20 transition"
              data-testid="vip-buy-btn"
            >
              <Sparkles size={16} />
              Acheter VIP Premium
              <ExternalLink size={14} className="opacity-70" />
            </a>
          </div>

          <p className="mt-4 flex items-center gap-1.5 text-[11px] text-white/45">
            <Check size={12} className="text-yellow-300/80" />
            Après votre achat sur Ko-fi, vous recevrez votre clé VIP par email.
          </p>
        </div>
      </div>

      {/* === Redeem card (2/5 width on desktop) === */}
      <div
        className="lg:col-span-2 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6 flex flex-col"
        data-testid="vip-redeem-card"
      >
        <div className="flex items-center gap-2 mb-2">
          <KeyRound size={18} className="text-cyan-400" />
          <h3 className="text-lg font-bold">J'ai déjà une clé</h3>
        </div>
        <p className="text-sm text-white/60 mb-5">
          Vous avez acheté une clé VIP ? Collez-la ici pour activer
          immédiatement votre accès.
        </p>

        <form onSubmit={handleRedeem} className="space-y-3 mt-auto">
          <div className="relative">
            <KeyRound
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
            />
            <input
              value={vipKey}
              onChange={(e) => setVipKey(e.target.value)}
              placeholder="VIP-XXXX-XXXX-XXXX"
              required
              autoComplete="off"
              spellCheck={false}
              data-testid="vip-key-input"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-400/50 font-mono text-sm tracking-wider uppercase"
            />
          </div>

          <button
            type="submit"
            disabled={redeeming || !vipKey.trim()}
            className="w-full px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:bg-white/10 disabled:text-white/40 text-black font-semibold flex items-center justify-center gap-2 transition"
            data-testid="vip-redeem-btn"
          >
            {redeeming ? (
              <>
                <Loader2 className="animate-spin" size={16} />
                Activation…
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Activer ma clé
              </>
            )}
          </button>
        </form>

        <p className="mt-4 text-[11px] text-white/40 leading-relaxed">
          La clé est à usage unique et liée à votre compte une fois activée.
        </p>
      </div>
    </section>
  );
}
