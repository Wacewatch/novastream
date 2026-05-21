import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import VideoPlayer from "@/components/VideoPlayer";
import AdUnlockModal from "@/components/AdUnlockModal";
import { Loader2 } from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || window.location.origin;
const API = `${BACKEND_URL}/api`;

/**
 * /embed/football/:matchId/:serverIdx?
 * Standalone Football player. Picks server[idx] (default 0) from
 * /api/football/streams and plays it through the HLS VideoPlayer behind
 * the ad-unlock gate. No source/server name is exposed — only the
 * generic match title.
 */
export default function FootballEmbedPage() {
  const { matchId, serverIdx } = useParams();
  const idx = Math.max(0, parseInt(serverIdx || "0", 10) || 0);
  const [match, setMatch] = useState(null);
  const [streamUrl, setStreamUrl] = useState(null);
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Look up match metadata + chosen server's stream URL.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [m, s] = await Promise.all([
          axios.get(`${API}/football/matches`),
          axios.get(`${API}/football/streams`, { params: { mid: matchId } }),
        ]);
        if (cancelled) return;
        const matched = (m.data?.matches || []).find((x) => String(x.id) === String(matchId));
        const srv = (s.data?.servers || [])[idx] || (s.data?.servers || [])[0];
        if (!matched) {
          setError("Match introuvable");
        } else if (!srv) {
          setError("Aucun serveur disponible");
          setMatch(matched);
        } else {
          setMatch(matched);
          setStreamUrl(srv.stream_url);
        }
      } catch (_e) {
        if (!cancelled) setError("Erreur de chargement");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [matchId, idx]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-[#ff2e63]" size={36} />
      </div>
    );
  }
  if (error || !match) {
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
          channel={{ name: match.title || "Match en direct" }}
          onUnlocked={() => setUnlocked(true)}
          onCancel={() => {/* embed mode */}}
        />
      )}
      {unlocked && streamUrl && (
        <VideoPlayer
          channel={{ id: match.id, name: match.title, country_code: "fb" }}
          streamUrl={streamUrl}
          onClose={() => {/* no close in embed */}}
          onRetry={() => setStreamUrl((u) => (u ? `${u}&_t=${Date.now()}` : u))}
        />
      )}
    </div>
  );
}
