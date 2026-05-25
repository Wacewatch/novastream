import { useCallback, useEffect, useRef, useState } from "react";
import { X, Maximize, Minimize, RotateCcw } from "lucide-react";

const isIOS = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iP(hone|od|ad)/.test(ua)) return true;
  return ua.includes("Mac") && navigator.maxTouchPoints > 1;
};

/**
 * Iframe player overlay used by DaddyTV (iframe fallback), Sports and Football.
 *
 * Visually mirrors the HLS <VideoPlayer/> layout: a centered 16/9
 * .player-frame inside a fixed .player-shell — NOT a full-bleed iframe.
 *
 * UI auto-hide: the top bar fades out after 3s of inactivity (mouse +
 * touch), in normal and fullscreen modes. Tapping the player toggles it.
 *
 * IMPORTANT: this component intentionally exposes NO link to the upstream
 * source URL (no "open in new tab"). The iframe `src` is the only place
 * the URL travels — never surfaced to the user via UI.
 */
export default function IframePlayer({
  src,
  title = "Live",
  onClose,
  onReload = null,
  rightSlot = null,
}) {
  const frameRef = useRef(null);
  const hideTimer = useRef(null);
  const [visible, setVisible] = useState(true);

  const showUi = useCallback(() => {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), 3000);
  }, []);

  useEffect(() => {
    showUi();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [showUi]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape" && onClose) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleTouchStart = () => {
    if (visible) {
      setVisible(false);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    } else {
      showUi();
    }
  };

  const [pseudoFs, setPseudoFs] = useState(false);

  const openFullscreen = () => {
    const el = frameRef.current;
    if (!el) return;
    // iOS Safari can't fullscreen an iframe container reliably — use a CSS
    // pseudo-fullscreen (cover the entire viewport, hide chrome) instead.
    if (isIOS() || !el.requestFullscreen) {
      setPseudoFs((v) => !v);
      try {
        if (!pseudoFs) {
          window.scrollTo(0, 0);
          document.body.style.overflow = "hidden";
        } else {
          document.body.style.overflow = "";
        }
      } catch (_) { /* noop */ }
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      el.requestFullscreen().catch(() => setPseudoFs(true));
    }
  };

  useEffect(() => () => { try { document.body.style.overflow = ""; } catch (_) {} }, []);

  const reload = () => {
    if (onReload) {
      onReload();
      return;
    }
    const ifr = document.getElementById("ns-iframe-frame-inner");
    if (ifr) {
      const u = ifr.src.split("#")[0];
      ifr.src = u + (u.includes("?") ? "&" : "?") + "_t=" + Date.now();
    }
  };

  return (
    <div
      className={`player-shell ${visible ? "" : "ui-hidden"} ${pseudoFs ? "pseudo-fs" : ""}`}
      data-testid="iframe-player"
      onMouseMove={showUi}
      onMouseLeave={() => {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        setVisible(false);
      }}
      onTouchStart={handleTouchStart}
    >
      <div className="player-frame" ref={frameRef}>
        {/* Top bar — overlays the iframe, auto-hides on idle. */}
        <div
          className={`iframe-player-top ${visible ? "visible" : "hidden-ui"}`}
          onMouseMove={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 min-w-0">
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
            <button
              type="button"
              onClick={openFullscreen}
              className="iframe-player-btn"
              title={pseudoFs ? "Quitter le plein écran" : "Plein écran"}
              data-testid="iframe-fullscreen-btn"
            >
              {pseudoFs ? <Minimize size={15} /> : <Maximize size={15} />}
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
