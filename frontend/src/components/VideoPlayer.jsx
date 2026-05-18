import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  X,
  PictureInPicture2,
  Loader2,
  RotateCcw,
} from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const LOGO_URL = "https://i.imgur.com/HrbEzpm.png";

export default function VideoPlayer({ channel, streamUrl, onClose, onRetry }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const containerRef = useRef(null);
  const hideTimer = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryToken, setRetryToken] = useState(0);

  const attach = useCallback(() => {
    if (!streamUrl || !videoRef.current) return () => {};
    const video = videoRef.current;
    const absUrl = streamUrl.startsWith("http") ? streamUrl : `${BACKEND_URL}${streamUrl}`;

    setLoading(true);
    setError(null);

    let destroyed = false;
    let hls = null;

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        // Live broadcast tuning: start fast, stay smooth even under load
        backBufferLength: 30,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
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
        if (destroyed) return;
        setLoading(false);
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (destroyed) return;
        if (data.fatal) {
          // Try graceful recovery first
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            try { hls.startLoad(); return; } catch (_) { /* fall through */ }
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            try { hls.recoverMediaError(); return; } catch (_) { /* fall through */ }
          }
          setError("Flux temporairement indisponible.");
          setLoading(false);
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS
      video.src = absUrl;
      const onMeta = () => {
        if (destroyed) return;
        setLoading(false);
        video.play().catch(() => {});
      };
      const onErr = () => {
        if (destroyed) return;
        setError("Flux temporairement indisponible.");
        setLoading(false);
      };
      video.addEventListener("loadedmetadata", onMeta);
      video.addEventListener("error", onErr);
    } else {
      setError("Lecteur non supporté sur ce navigateur.");
      setLoading(false);
    }

    return () => {
      destroyed = true;
      if (hls) {
        try { hls.destroy(); } catch (_) { /* noop */ }
      }
      hlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl, retryToken]);

  useEffect(() => {
    const cleanup = attach();
    return cleanup;
  }, [attach]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setLoading(true);
    const onPlaying = () => setLoading(false);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("playing", onPlaying);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("playing", onPlaying);
    };
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const onVolume = (e) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      if (val === 0) {
        videoRef.current.muted = true;
        setMuted(true);
      } else if (videoRef.current.muted) {
        videoRef.current.muted = false;
        setMuted(false);
      }
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen?.();
    }
  };

  const togglePip = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await v.requestPictureInPicture();
      }
    } catch {
      // ignore
    }
  };

  const handleRetry = () => {
    if (onRetry) {
      onRetry();
    } else {
      setRetryToken((t) => t + 1);
    }
  };

  const showControls = () => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), 3000);
  };

  return (
    <div className="player-shell" data-testid="video-player-shell" onMouseMove={showControls}>
      <div className="player-frame" ref={containerRef}>
        <video
          ref={videoRef}
          playsInline
          autoPlay
          data-testid="video-element"
          onClick={togglePlay}
        />

        {/* Watermark logo — fades together with the UI controls */}
        <img
          src={LOGO_URL}
          alt="LiveWatch"
          className={`player-watermark ${controlsVisible ? "visible" : ""}`}
          draggable={false}
        />

        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none">
            <Loader2 className="animate-spin text-white/90" size={42} />
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/75 px-6 text-center gap-3">
            <p className="text-white/90 text-base">{error}</p>
            <div className="flex gap-2">
              <button
                onClick={handleRetry}
                className="ad-btn-secondary"
                data-testid="player-error-retry-btn"
              >
                <RotateCcw size={16} className="inline-block mr-2" />
                Réessayer
              </button>
              <button
                onClick={onClose}
                className="ad-btn-secondary"
                data-testid="player-error-close-btn"
              >
                Fermer
              </button>
            </div>
          </div>
        )}

        <div className={`player-controls ${controlsVisible ? "visible" : ""}`}>
          {/* Top bar */}
          <div className="player-top">
            <div className="flex items-center gap-3 min-w-0">
              <span className="live-badge"><span className="dot" />En direct</span>
              <h3 className="text-white text-base font-semibold truncate" data-testid="player-channel-name">
                {channel?.name}
              </h3>
            </div>
            <button onClick={onClose} className="player-btn" data-testid="player-close-btn" aria-label="Fermer">
              <X size={20} />
            </button>
          </div>

          {/* Bottom bar */}
          <div className="player-bottom">
            <button onClick={togglePlay} className="player-btn" data-testid="video-play-btn" aria-label="Lecture/Pause">
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>

            <button onClick={handleRetry} className="player-btn" data-testid="video-retry-btn" aria-label="Réessayer">
              <RotateCcw size={20} />
            </button>

            <div className="flex items-center gap-2">
              <button onClick={toggleMute} className="player-btn" data-testid="video-mute-btn" aria-label="Son">
                {muted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={muted ? 0 : volume}
                onChange={onVolume}
                className="volume-slider"
                data-testid="video-volume-slider"
              />
            </div>

            <div className="flex-1" />

            <button onClick={togglePip} className="player-btn hidden sm:inline-flex" data-testid="video-pip-btn" aria-label="Picture-in-Picture">
              <PictureInPicture2 size={20} />
            </button>
            <button onClick={toggleFullscreen} className="player-btn" data-testid="video-fullscreen-btn" aria-label="Plein écran">
              {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { Loader2 };
