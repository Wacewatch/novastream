import { useEffect } from "react";
import { ArrowLeft, ExternalLink, Maximize2 } from "lucide-react";

/**
 * Full-screen iframe overlay player for DaddyTV / Sports / Football streams.
 * Props:
 *   - src: iframe URL
 *   - title: top bar title
 *   - onClose: () => void
 *   - rightSlot: optional ReactNode (e.g. source picker)
 */
export default function IframePlayer({ src, title = "Live", onClose, rightSlot = null }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape" && onClose) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const fullscreen = () => {
    const el = document.getElementById("ns-iframe-frame");
    if (!el) return;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  };

  return (
    <div className="iframe-shell" data-testid="iframe-player">
      <div className="iframe-shell-bar">
        <button onClick={onClose} data-testid="iframe-close">
          <ArrowLeft size={16} /> Retour
        </button>
        <div className="flex-1 min-w-0 truncate text-white/90">{title}</div>
        {rightSlot}
        <button onClick={fullscreen} title="Plein écran">
          <Maximize2 size={16} /> Plein écran
        </button>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white/80 text-sm border border-white/15 hover:border-[#ff2e63]/40 hover:text-white"
          title="Ouvrir dans un nouvel onglet"
        >
          <ExternalLink size={14} />
        </a>
      </div>
      <iframe
        id="ns-iframe-frame"
        src={src}
        className="iframe-shell-frame"
        title={title}
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
