import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

export default function VideoPlayer({ channel, streamUrl, onClose }) {
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

  useEffect(() => {
    if (!streamUrl || !videoRef.current) return;

    const video = videoRef.current;
    const absUrl = streamUrl.startsWith("http") ? streamUrl : `${BACKEND_URL}${streamUrl}`;

    setLoading(true);
    setError(null);

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hlsRef.current = hls;
      hls.loadSource(absUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          setError("Flux indisponible. Essayez une autre chaîne.");
          setLoading(false);
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = absUrl;
      video.addEventListener("loadedmetadata", () => {
        setLoading(false);
        video.play().catch(() => {});
      });
    } else {
      setError("Lecteur non supporté sur ce navigateur.");
      setLoading(false);
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamUrl]);

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

        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="spinner" />
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 px-6 text-center">
            <p className="text-white/90 text-base mb-3">{error}</p>
            <button
              onClick={onClose}
              className="ad-btn-secondary max-w-[200px]"
              data-testid="player-error-close-btn"
            >
              Fermer
            </button>
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

// Tiny re-export of loader icon spinner usage from lucide for the spinner div fallback
export { Loader2 };
