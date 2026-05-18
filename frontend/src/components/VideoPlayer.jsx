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
  Loader2,
  RotateCcw,
  MoreVertical,
  Check,
  ChevronRight,
  ChevronLeft,
  PictureInPicture2,
  Link as LinkIcon,
  Gauge,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const LOGO_URL = "https://i.imgur.com/V8YmT4z.png";
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export default function VideoPlayer({ channel, streamUrl, onClose, onRetry }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const containerRef = useRef(null);
  const hideTimer = useRef(null);
  const menuRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryToken, setRetryToken] = useState(0);

  // Menu state
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState("root"); // root | quality | speed
  const [qualityLevels, setQualityLevels] = useState([]); // HLS levels
  const [currentLevel, setCurrentLevel] = useState(-1);   // -1 = auto
  const [speed, setSpeed] = useState(1);

  const attach = useCallback(() => {
    if (!streamUrl || !videoRef.current) return () => {};
    const video = videoRef.current;
    const absUrl = streamUrl.startsWith("http") ? streamUrl : `${BACKEND_URL}${streamUrl}`;

    setLoading(true);
    setError(null);
    setQualityLevels([]);
    setCurrentLevel(-1);

    let destroyed = false;
    let hls = null;

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: false,
        lowLatencyMode: true,
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
        setQualityLevels(
          (hls.levels || []).map((lv, i) => ({
            index: i,
            height: lv.height,
            width: lv.width,
            bitrate: lv.bitrate,
          }))
        );
        setCurrentLevel(hls.currentLevel);
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
        if (destroyed) return;
        setCurrentLevel(data.level);
      });

      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (destroyed) return;
        try {
          if (data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              try { hls.startLoad(); return; } catch (_err) { /* noop */ }
            }
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              try { hls.recoverMediaError(); return; } catch (_err) { /* noop */ }
            }
            setError("Flux temporairement indisponible.");
            setLoading(false);
          }
        } catch (_outer) {
          /* swallow */
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
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

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
        setMenuView("root");
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

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
      toast.error("Picture-in-Picture indisponible");
    }
  };

  const handleRetry = () => {
    if (onRetry) onRetry();
    else setRetryToken((t) => t + 1);
  };

  const copyEmbedUrl = async () => {
    if (!channel?.id) return;
    const embedUrl = `${window.location.origin}/embed/${encodeURIComponent(channel.id)}`;
    try {
      await navigator.clipboard.writeText(embedUrl);
      toast.success("URL embed copiée", { description: embedUrl, duration: 3500 });
    } catch (_e) {
      try {
        const ta = document.createElement("textarea");
        ta.value = embedUrl;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        toast.success("URL embed copiée");
      } catch {
        toast.error("Impossible de copier l'URL");
      }
    }
  };

  const setHlsLevel = (level) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = level;
      setCurrentLevel(level);
    }
  };

  const setPlaybackSpeed = (s) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = s;
      setSpeed(s);
    }
  };

  const showControls = () => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!menuOpen) {
      hideTimer.current = setTimeout(() => setControlsVisible(false), 3000);
    }
  };

  const formatLevel = (lv) => {
    if (!lv) return "Auto";
    if (lv.height) return `${lv.height}p`;
    return `${Math.round((lv.bitrate || 0) / 1000)} kbps`;
  };
  const currentQualityLabel =
    currentLevel === -1 || !qualityLevels.length
      ? "Auto"
      : formatLevel(qualityLevels.find((l) => l.index === currentLevel));

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

        {/* Watermark logo — top-left, under "EN DIRECT" */}
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
              <button onClick={handleRetry} className="ad-btn-secondary" data-testid="player-error-retry-btn">
                <RotateCcw size={16} className="inline-block mr-2" />
                Réessayer
              </button>
              <button onClick={onClose} className="ad-btn-secondary" data-testid="player-error-close-btn">
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

            <button onClick={toggleFullscreen} className="player-btn" data-testid="video-fullscreen-btn" aria-label="Plein écran">
              {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>

            {/* Menu (kebab) */}
            <div className="player-menu-wrap" ref={menuRef}>
              <button
                onClick={() => { setMenuOpen((o) => !o); setMenuView("root"); }}
                className="player-btn"
                data-testid="video-menu-btn"
                aria-label="Menu"
              >
                <MoreVertical size={20} />
              </button>

              {menuOpen && (
                <div className="player-menu" data-testid="video-menu">
                  {menuView === "root" && (
                    <>
                      <button
                        className="menu-item"
                        onClick={() => setMenuView("quality")}
                        data-testid="menu-quality"
                      >
                        <span className="flex items-center gap-2">
                          <Wand2 size={16} />
                          Qualité
                        </span>
                        <span className="menu-value">
                          {currentQualityLabel}
                          <ChevronRight size={14} />
                        </span>
                      </button>

                      <button
                        className="menu-item"
                        onClick={() => setMenuView("speed")}
                        data-testid="menu-speed"
                      >
                        <span className="flex items-center gap-2">
                          <Gauge size={16} />
                          Vitesse
                        </span>
                        <span className="menu-value">
                          {speed}x
                          <ChevronRight size={14} />
                        </span>
                      </button>

                      <div className="menu-separator" />

                      <button
                        className="menu-item"
                        onClick={() => { togglePip(); setMenuOpen(false); }}
                        data-testid="menu-pip"
                      >
                        <span className="flex items-center gap-2">
                          <PictureInPicture2 size={16} />
                          Picture-in-Picture
                        </span>
                      </button>

                      <button
                        className="menu-item"
                        onClick={() => { copyEmbedUrl(); setMenuOpen(false); }}
                        data-testid="menu-embed"
                      >
                        <span className="flex items-center gap-2">
                          <LinkIcon size={16} />
                          Copier l'URL embed
                        </span>
                      </button>
                    </>
                  )}

                  {menuView === "quality" && (
                    <>
                      <button className="menu-back" onClick={() => setMenuView("root")}>
                        <ChevronLeft size={14} />
                        Qualité
                      </button>
                      <button
                        className={`menu-radio ${currentLevel === -1 ? "active" : ""}`}
                        onClick={() => setHlsLevel(-1)}
                        data-testid="quality-auto"
                      >
                        Auto
                        {currentLevel === -1 && <Check size={14} className="check" />}
                      </button>
                      {qualityLevels.length === 0 && (
                        <div className="menu-title" style={{ color: "rgba(255,255,255,0.4)", fontWeight: 400 }}>
                          Un seul niveau disponible
                        </div>
                      )}
                      {qualityLevels.map((lv) => (
                        <button
                          key={lv.index}
                          className={`menu-radio ${currentLevel === lv.index ? "active" : ""}`}
                          onClick={() => setHlsLevel(lv.index)}
                          data-testid={`quality-${lv.height || lv.index}`}
                        >
                          {formatLevel(lv)}
                          {currentLevel === lv.index && <Check size={14} className="check" />}
                        </button>
                      ))}
                    </>
                  )}

                  {menuView === "speed" && (
                    <>
                      <button className="menu-back" onClick={() => setMenuView("root")}>
                        <ChevronLeft size={14} />
                        Vitesse
                      </button>
                      {SPEEDS.map((s) => (
                        <button
                          key={s}
                          className={`menu-radio ${speed === s ? "active" : ""}`}
                          onClick={() => setPlaybackSpeed(s)}
                          data-testid={`speed-${s}`}
                        >
                          {s}x{s === 1 && <span className="text-white/40 text-xs ml-1">normal</span>}
                          {speed === s && <Check size={14} className="check" />}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export { Loader2 };
