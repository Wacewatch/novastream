import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import AdUnlockModal from "@/components/AdUnlockModal";
import Jack07Overlay from "@/components/Jack07Overlay";
import { Loader2 } from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || window.location.origin;
const API = `${BACKEND_URL}/api`;

/**
 * /embed/jack07/:matchId
 * Standalone Jack07 TV player — fetches detail, then renders the overlay
 * (iframe + live events/stats) gated by the ad-unlock modal.
 */
export default function Jack07EmbedPage() {
  const { matchId } = useParams();
  const [detail, setDetail] = useState(null);
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API}/jack07/detail/${matchId}`);
        if (cancelled) return;
        if (!r.data?.site_url) {
          setError("Match introuvable ou flux indisponible");
        } else {
          setDetail(r.data);
        }
      } catch (_e) {
        if (!cancelled) setError("Erreur de chargement");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [matchId]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-amber-400" size={36} />
      </div>
    );
  }
  if (error || !detail) {
    return (
      <div className="fixed inset-0 bg-black text-white flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-lg mb-2">{error || "Erreur inconnue"}</p>
          <p className="text-white/50 text-sm">Match: {matchId}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black">
      {!unlocked && (
        <AdUnlockModal
          channel={{ name: detail.title || `${detail.home?.name || ""} vs ${detail.away?.name || ""}` }}
          onUnlocked={() => setUnlocked(true)}
          onCancel={() => {/* embed mode: stay */}}
        />
      )}
      {unlocked && (
        <Jack07Overlay
          match={detail}
          detail={detail}
          onClose={() => {/* embed mode: no close */}}
        />
      )}
    </div>
  );
}
