import { useMemo, useState, memo } from "react";
import { Plus, Tv2, X as XIcon, Pencil, RotateCcw, Radio, Trophy } from "lucide-react";

function MultiViewCell({ index, channel, onPick, onClear }) {
  const [reloadToken, setReloadToken] = useState(0);

  const embedSrc = useMemo(() => {
    if (!channel) return null;
    // Prefer the explicit `src` (v2 multi-source cells), fall back to legacy
    // `/embed/{id}` for older saved sessions.
    const base = channel.src
      || (channel.id ? `/embed/${encodeURIComponent(channel.id)}` : null);
    if (!base) return null;
    if (!reloadToken) return base;
    return base.includes("?") ? `${base}&r=${reloadToken}` : `${base}?r=${reloadToken}`;
  }, [channel, reloadToken]);

  const KindIcon = useMemo(() => {
    if (!channel) return Tv2;
    if (channel.kind === "daddy") return Radio;
    if (channel.kind === "sports") return Trophy;
    return Tv2;
  }, [channel]);

  const handleReload = (e) => {
    e.stopPropagation();
    setReloadToken((t) => t + 1);
  };
  const handleClear = (e) => {
    e.stopPropagation();
    onClear();
  };
  const handlePick = (e) => {
    e.stopPropagation();
    onPick();
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
    <div className="mv-cell mv-cell-iframe" data-testid={`mv-cell-${index}`}>
      <iframe
        key={embedSrc}
        src={embedSrc}
        title={channel.name}
        className="mv-iframe"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="origin"
        data-testid={`mv-iframe-${index}`}
      />

      {/* Hover overlay — top-right floating controls (do not block iframe interaction) */}
      <div className="mv-cell-overlay" data-testid={`mv-cell-overlay-${index}`}>
        <div className="mv-cell-overlay-inner">
          <span className="mv-overlay-name" title={channel.name}>
            <KindIcon size={11} className="opacity-70" />
            {channel.name}
          </span>
          <div className="mv-overlay-actions">
            <button onClick={handleReload} className="mv-icon-btn" title="Recharger" data-testid={`mv-reload-${index}`}>
              <RotateCcw size={13} />
            </button>
            <button onClick={handlePick} className="mv-icon-btn" title="Changer" data-testid={`mv-change-${index}`}>
              <Pencil size={13} />
            </button>
            <button onClick={handleClear} className="mv-icon-btn" title="Retirer" data-testid={`mv-clear-${index}`}>
              <XIcon size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(MultiViewCell);
