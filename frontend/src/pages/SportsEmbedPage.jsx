import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import axios from "axios";
import AdUnlockModal from "@/components/AdUnlockModal";
import { Loader2 } from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

/**
 * /embed/sports/:source/:id
 * Standalone Sports player used by MultiView iframes.
 * Resolves /api/sports/streams?source=&id= and iframes the first stream.
 */
export default function SportsEmbedPage() {
  const { source, id } = useParams();
  const [params] = useSearchParams();
  const titleParam = params.get("t") || "Match en direct";

  const [embedUrl, setEmbedUrl] = useState(null);
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const resolveStream = async () => {
    try {
      const r = await axios.get(`${API}/sports/streams`, { params: { source, id } });
      const streams = r.data?.streams || [];
      const url = streams[0]?.embedUrl || streams[0]?.embed_url;
      if (!url) {
        setError("Aucun flux disponible");
        return;
      }
      setEmbedUrl(url);
    } catch (e) {
      setError("Flux indisponible");
    } finally {
      setLoading(false);
    }
  };

  // Fetch immediately to know if a stream exists (so the lock modal isn't shown if not).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await resolveStream();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, id]);

  const handleUnlocked = () => {
    setUnlocked(true);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-emerald-400" size={36} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black text-white flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-lg mb-2">{error}</p>
          <p className="text-white/50 text-sm">{source} · {id}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black">
      {!unlocked && (
        <AdUnlockModal
          channel={{ name: decodeURIComponent(titleParam) }}
          onUnlocked={handleUnlocked}
          onCancel={() => {/* embed mode: no cancel */}}
        />
      )}

      {unlocked && embedUrl && (
        <iframe
          src={embedUrl}
          title={titleParam}
          className="w-full h-full border-0"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  );
}
