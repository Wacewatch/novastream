import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { Loader2 } from "lucide-react";
import AdUnlockModal from "@/components/AdUnlockModal";
import VideoPlayer from "@/components/VideoPlayer";

const API = `${process.env.NEXT_PUBLIC_BACKEND_URL || process.env.REACT_APP_BACKEND_URL || ''}/api`;

export default function FrameEmbedPage() {
  const { channelId } = useParams();
  const [unlocked, setUnlocked] = useState(false);
  const [streamUrl, setStreamUrl] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!unlocked) return;
    (async () => {
      try {
        const r = await axios.get(`${API}/frame/stream/${encodeURIComponent(channelId)}`);
        if (r.data?.stream_url) setStreamUrl(r.data.stream_url);
        else setError("Flux indisponible");
      } catch (e) {
        setError("Flux indisponible");
      }
    })();
  }, [unlocked, channelId]);

  if (!unlocked) {
    return (
      <AdUnlockModal
        channel={{ name: `FrameTV — ${channelId}` }}
        onUnlocked={() => setUnlocked(true)}
        onCancel={() => window.history.back()}
      />
    );
  }
  if (error) return <div className="p-10 text-white/70">{error}</div>;
  if (!streamUrl) return (
    <div className="fixed inset-0 flex items-center justify-center bg-black">
      <Loader2 className="animate-spin text-white/70" size={32} />
    </div>
  );
  return (
    <VideoPlayer
      channel={{ id: channelId, name: `FrameTV — ${channelId}`, country_code: "frame" }}
      streamUrl={streamUrl}
      onClose={() => window.history.back()}
    />
  );
}
