import { useEffect, useRef } from "react";
import { X, ExternalLink, Maximize, RotateCcw } from "lucide-react";

const LOGO_URL = "https://i.imgur.com/V8YmT4z.png";

/**
 * Iframe player overlay used by DaddyTV (iframe fallback), Sports and Football.
 *
 * Visually mirrors the HLS <VideoPlayer/> layout: a centered 16/9
 * .player-frame inside a fixed .player-shell — NOT a full-bleed iframe.
 *
 * Props:
 *   - src: iframe URL
 *   - title: top-bar title
 *   - onClose: () => void (closes overlay)
 *   - onReload?: () => void (reload the iframe — emits a fresh `?_t=…`)
 *   - rightSlot: optional ReactNode (e.g. source picker)
 */
export default function IframePlayer({
  src,
  title = "Live",
  onClose,
  onReload = null,
  rightSlot = null,
}) {
  const frameRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape" && onClose) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const openFullscreen = () => {
    const el = frameRef.current;
    if (!el) return;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  };

  const reload = () => {
    if (onReload) {
      onReload();
      return;
    }
    // Default: bust the iframe src by appending a timestamp.
    const ifr = document.getElementById("ns-iframe-frame-inner");
    if (ifr) {
      const u = ifr.src.split("#")[0];
      ifr.src = u + (u.includes("?") ? "&" : "?") + "_t=" + Date.now();
    }
  };

  return (
    <div className="player-shell" data-testid="iframe-player">
      <div className="player-frame" ref={frameRef}>
        {/* Top bar — overlays the iframe, matches VideoPlayer's top controls */}
        <div className="iframe-player-top">
          <div className="flex items-center gap-2 min-w-0">
            <img src={LOGO_URL} alt="" className="w-6 h-6 rounded" />
            <span className="truncate text-white/90 font-semibold text-sm">{title}</span>
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            {rightSlot}
            <button
              type="button"
              onClick={reload}
              className="iframe-player-btn"
              title="Recharger"
              data-testid="iframe-reload-btn"
            >
              <RotateCcw size={15} />
            </button>
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              className="iframe-player-btn"
              title="Ouvrir dans un nouvel onglet"
              data-testid="iframe-external-btn"
            >
              <ExternalLink size={15} />
            </a>
            <button
              type="button"
              onClick={openFullscreen}
              className="iframe-player-btn"
              title="Plein écran"
              data-testid="iframe-fullscreen-btn"
            >
              <Maximize size={15} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="iframe-player-btn iframe-player-btn-close"
              title="Fermer"
              data-testid="iframe-close-btn"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <iframe
          id="ns-iframe-frame-inner"
          src={src}
          className="iframe-player-iframe"
          title={title}
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="no-referrer"
        />
      </div>
    </div>
  );
}
