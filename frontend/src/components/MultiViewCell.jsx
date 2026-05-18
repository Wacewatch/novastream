import { useEffect, useRef, useState, memo } from "react";
import Hls from "hls.js";
import axios from "axios";
import { Plus, Tv, Volume2, VolumeX, RotateCcw, X as XIcon, Pencil, Loader2 } from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function MultiViewCell({ index, channel, isFocused, onFocus, onPick, onClear }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [retryToken, setRetryToken] = useState(0);

  // Resolve + attach HLS whenever channel or retryToken changes
  useEffect(() => {
    if (!channel) return;
    let cancelled = false;
    let hls = null;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const r = await axios.get(`${API}/stream/${encodeURIComponent(channel.id)}`);
        if (cancelled) return;
        const url = r.data.proxy_url;
        const absUrl = url.startsWith("http") ? url : `${BACKEND_URL}${url}`;
        const video = videoRef.current;
        if (!video) return;

        if (Hls.isSupported()) {
          hls = new Hls({
            enableWorker: false,
            lowLatencyMode: true,
            backBufferLength: 15,
            maxBufferLength: 20,
            maxMaxBufferLength: 40,
            liveSyncDurationCount: 3,
            liveMaxLatencyDurationCount: 8,
            manifestLoadingTimeOut: 12000,
            manifestLoadingMaxRetry: 2,
            levelLoadingTimeOut: 12000,
            levelLoadingMaxRetry: 4,
            fragLoadingTimeOut: 20000,
            fragLoadingMaxRetry: 6,
          });
          hlsRef.current = hls;
          hls.loadSource(absUrl);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (cancelled) return;
            setLoading(false);
            // Force lowest level on multiview to save bandwidth + CPU
            try {
              if (hls.levels && hls.levels.length > 1) {
                hls.currentLevel = 0;
              }
            } catch (_) { /* noop */ }
            video.play().catch(() => {});
          });
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (cancelled) return;
            if (data.fatal) {
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                try { hls.startLoad(); return; } catch (_err) { /* noop */ }
              }
              if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                try { hls.recoverMediaError(); return; } catch (_err) { /* noop */ }
              }
              setError("Flux indisponible");
              setLoading(false);
            }
          });
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = absUrl;
          video.addEventListener("loadedmetadata", () => {
            if (cancelled) return;
            setLoading(false);
            video.play().catch(() => {});
          });
          video.addEventListener("error", () => {
            if (cancelled) return;
            setError("Flux indisponible");
            setLoading(false);
          });
        } else {
          setError("HLS non supporté");
          setLoading(false);
        }
      } catch (e) {
        if (cancelled) return;
        setError("Erreur de chargement");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (hls) { try { hls.destroy(); } catch (_) { /* noop */ } }
      hlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.id, retryToken]);

  // Sync mute state with focus
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !isFocused;
    if (isFocused) v.volume = 1;
  }, [isFocused, channel?.id]);

  const handleRetry = (e) => {
    e.stopPropagation();
    setRetryToken((t) => t + 1);
  };
  const handleClear = (e) => {
    e.stopPropagation();
    onClear();
  };
  const handlePick = (e) => {
    e.stopPropagation();
    onPick();
  };
  const handleToggleMute = (e) => {
    e.stopPropagation();
    onFocus();
  };

  if (!channel) {
    return (
      <button
        type="button"
        onClick={onPick}
        className="mv-cell mv-cell-empty"
        data-testid={`mv-cell-empty-${index}`}
      >
        <div className="mv-cell-empty-inner">
          <Plus size={28} className="text-white/40" />
          <span className="text-white/50 text-sm mt-2">Ajouter une chaîne</span>
          <span className="text-white/30 text-[10px] mt-1 uppercase tracking-wider">Slot {index + 1}</span>
        </div>
      </button>
    );
  }

  return (
    <div
      className={`mv-cell ${isFocused ? "is-focused" : ""}`}
      onClick={onFocus}
      data-testid={`mv-cell-${index}`}
      role="button"
      tabIndex={0}
    >
      <video
        ref={videoRef}
        playsInline
        autoPlay
        muted
        className="mv-video"
        data-testid={`mv-video-${index}`}
      />

      {/* Top bar */}
      <div className="mv-top">
        <div className="mv-top-left">
          <span className="mv-live"><span className="dot" />LIVE</span>
          <span className="mv-name" title={channel.name}>{channel.name}</span>
        </div>
        <div className="mv-top-right">
          <button onClick={handlePick} className="mv-icon-btn" title="Changer" data-testid={`mv-change-${index}`}>
            <Pencil size={13} />
          </button>
          <button onClick={handleClear} className="mv-icon-btn" title="Retirer" data-testid={`mv-clear-${index}`}>
            <XIcon size={14} />
          </button>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="mv-bottom">
        <button onClick={handleToggleMute} className="mv-icon-btn" title={isFocused ? "Couper" : "Activer le son"} data-testid={`mv-mute-${index}`}>
          {isFocused ? <Volume2 size={14} /> : <VolumeX size={14} />}
        </button>
        <button onClick={handleRetry} className="mv-icon-btn" title="Recharger" data-testid={`mv-retry-${index}`}>
          <RotateCcw size={13} />
        </button>
      </div>

      {loading && !error && (
        <div className="mv-overlay">
          <Loader2 className="animate-spin text-white/80" size={22} />
        </div>
      )}
      {error && (
        <div className="mv-overlay mv-overlay-error">
          <Tv size={20} className="text-white/60 mb-1" />
          <p className="text-white/80 text-xs mb-2">{error}</p>
          <button onClick={handleRetry} className="mv-retry-btn">
            <RotateCcw size={12} className="inline mr-1" />Réessayer
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(MultiViewCell);
