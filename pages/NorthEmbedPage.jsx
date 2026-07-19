import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { Loader2 } from "lucide-react";
import AdUnlockModal from "@/components/AdUnlockModal";
import VideoPlayer from "@/components/VideoPlayer";
import IframePlayer from "@/components/IframePlayer";

const API = `${process.env.NEXT_PUBLIC_BACKEND_URL || process.env.REACT_APP_BACKEND_URL || ''}/api`;

export default function NorthEmbedPage() {
  const { slug } = useParams();
  const [unlocked, setUnlocked] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!unlocked) return;
    (async () => {
      try {
        const r = await axios.get(`${API}/north/stream/${encodeURIComponent(slug)}`);
        setData(r.data);
      } catch (e) {
        setError("Flux indisponible");
      }
    })();
  }, [unlocked, slug]);

  if (!unlocked) {
    return (
      <AdUnlockModal
        channel={{ name: `NorthTV — ${slug}` }}
        onUnlocked={() => setUnlocked(true)}
        onCancel={() => window.history.back()}
      />
    );
  }
  if (error) return <div className="p-10 text-white/70">{error}</div>;
  if (!data) return (
    <div className="fixed inset-0 flex items-center justify-center bg-black">
      <Loader2 className="animate-spin text-white/70" size={32} />
    </div>
  );
  if (data.stream_url) {
    return (
      <VideoPlayer
        channel={{ id: slug, name: `NorthTV — ${slug}`, country_code: "north" }}
        streamUrl={data.stream_url}
        onClose={() => window.history.back()}
      />
    );
  }
  return (
    <IframePlayer
      src={data.iframe_url}
      title={`NorthTV — ${slug}`}
      onClose={() => window.history.back()}
    />
  );
}
