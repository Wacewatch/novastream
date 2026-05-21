import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import VideoPlayer from "@/components/VideoPlayer";
import AdUnlockModal from "@/components/AdUnlockModal";
import { Loader2 } from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || window.location.origin;
const API = `${BACKEND_URL}/api`;

/**
 * /embed/daddy/:channelId
 * Standalone DaddyTV player used by MultiView iframes and 3rd-party embeds.
 * Tries HLS first (via /api/daddy/stream) then falls back to the
 * proxyPlayerUrl iframe if HLS fails.
 */
export default function DaddyEmbedPage() {
  const { channelId } = useParams();
  const [channel, setChannel] = useState(null);
  const [streamUrl, setStreamUrl] = useState(null);
  const [iframeUrl, setIframeUrl] = useState(null);
  const [useIframe, setUseIframe] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [started, setStarted] = useState(false);

  // 8-second watchdog: if HLS hasn't started playing within 8s, swap to iframe.
  // This kicks in faster than waiting for hls.js to consume its 3 retry budget
  // (which can take 20–30 s on flaky upstreams).
  useEffect(() => {
    if (!unlocked || !streamUrl || useIframe || started) return;
    const t = setTimeout(() => {
      if (iframeUrl) setUseIframe(true);
    }, 8000);
    return () => clearTimeout(t);
  }, [unlocked, streamUrl, useIframe, started, iframeUrl]);

  // Fetch channel metadata
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API}/daddy/channel/${encodeURIComponent(channelId)}`);
        if (!cancelled) setChannel(r.data);
      } catch (e) {
        if (!cancelled) setError("Chaîne introuvable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [channelId]);

  const resolveStream = async () => {
    try {
      const r = await axios.get(`${API}/daddy/stream/${encodeURIComponent(channelId)}`);
      const data = r.data || {};
      setIframeUrl(data.iframe_url || data.embed_url || "");
      if (data.stream_url) {
        setStreamUrl(data.stream_url);
        setUseIframe(false);
      } else {
        // No HLS available — straight to iframe.
        setUseIframe(true);
      }
    } catch (e) {
      setError("Flux indisponible");
    }
  };

  const handleUnlocked = async () => {
    setUnlocked(true);
    await resolveStream();
  };

  const handleHlsError = () => {
    if (iframeUrl) {
      setUseIframe(true);
    }
  };

  const handleRetry = async () => {
    if (useIframe) {
      // Force reload iframe by tweaking key
      setIframeUrl((u) => (u ? `${u}${u.includes("?") ? "&" : "?"}_t=${Date.now()}` : u));
      return;
    }
    try {
      const r = await axios.get(`${API}/daddy/stream/${encodeURIComponent(channelId)}`);
      const data = r.data || {};
      setIframeUrl(data.iframe_url || data.embed_url || iframeUrl);
      if (data.stream_url) {
        setStreamUrl(`${data.stream_url}&_t=${Date.now()}`);
      } else if (data.iframe_url || data.embed_url) {
        setUseIframe(true);
      }
    } catch (e) {
      setError("Flux indisponible");
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-[#ff8a00]" size={36} />
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
      {!unlocked && (
        <AdUnlockModal
          channel={channel}
          adult={(channel?.category || "").includes("18")}
          onUnlocked={handleUnlocked}
          onCancel={() => {/* embed mode: no cancel */}}
        />
      )}

      {unlocked && !useIframe && streamUrl && (
        <VideoPlayer
          channel={channel}
          streamUrl={streamUrl}
          onClose={() => {/* no close in embed */}}
          onRetry={handleRetry}
          onError={handleHlsError}
          onStarted={() => setStarted(true)}
        />
      )}

      {unlocked && useIframe && iframeUrl && (
        <iframe
          src={iframeUrl}
          title={channel.name}
          className="w-full h-full border-0"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="no-referrer"
        />
      )}

      {unlocked && !streamUrl && !iframeUrl && !error && (
        <div className="fixed inset-0 bg-black flex items-center justify-center">
          <Loader2 className="animate-spin text-[#ff8a00]" size={36} />
        </div>
      )}
    </div>
  );
}
