import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import VideoPlayer from "@/components/VideoPlayer";
import AdUnlockModal from "@/components/AdUnlockModal";
import { Loader2 } from "lucide-react";
import { fetchTvStream } from "@/lib/streamApi";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export default function EmbedPage() {
  const { channelId } = useParams();
  const [channel, setChannel] = useState(null);
  const [streamUrl, setStreamUrl] = useState(null);
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch channel metadata
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API}/v1/public/channel/${encodeURIComponent(channelId)}`);
        if (!cancelled) setChannel(r.data);
      } catch (e) {
        if (!cancelled) setError("Chaîne introuvable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [channelId]);

  const handleUnlocked = async () => {
    setUnlocked(true);
    try {
      const data = await fetchTvStream(channelId);
      setStreamUrl(data.proxy_url);
    } catch (e) {
      setError("Flux indisponible");
    }
  };

  const handleRetry = async () => {
    try {
      const data = await fetchTvStream(channelId);
      setStreamUrl(`${data.proxy_url}&_t=${Date.now()}`);
    } catch (e) {
      setError("Flux indisponible");
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-[#ff2e63]" size={36} />
      </div>
    );
  }

  if (error || !channel) {
    return (
      <div className="fixed inset-0 bg-black text-white flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-lg mb-2">{error || "Erreur inconnue"}</p>
          <p className="text-white/50 text-sm">ID: {channelId}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black">
      {/* Unlock modal first */}
      {!unlocked && (
        <AdUnlockModal
          channel={channel}
          onUnlocked={handleUnlocked}
          onCancel={() => {/* in embed mode we don't allow cancel — just keep modal */}}
        />
      )}
      {unlocked && streamUrl && (
        <VideoPlayer
          channel={channel}
          streamUrl={streamUrl}
          onClose={() => {/* no close in embed */}}
          onRetry={handleRetry}
        />
      )}
      {unlocked && !streamUrl && !error && (
        <div className="fixed inset-0 bg-black flex items-center justify-center">
          <Loader2 className="animate-spin text-[#ff2e63]" size={36} />
        </div>
      )}
    </div>
  );
}
