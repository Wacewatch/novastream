import { useState } from "react";
import { Tv } from "lucide-react";

export default function ChannelCard({ channel, onClick }) {
  const [imgError, setImgError] = useState(!channel.logo);

  return (
    <button
      onClick={onClick}
      className="channel-card glass reveal text-left"
      data-testid={`channel-card-${channel.id}`}
      aria-label={`Lancer ${channel.name}`}
    >
      <div className="absolute top-3 right-3 z-10">
        <span className="live-badge">
          <span className="dot" />
          Live
        </span>
      </div>

      <div className="absolute inset-0 flex items-center justify-center p-4">
        {!imgError ? (
          <img
            src={channel.logo}
            alt={channel.name}
            className="channel-logo"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Tv size={28} className="text-white/40" />
            <span className="channel-fallback">{channel.name}</span>
          </div>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 px-3 py-2.5 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
        <p className="text-white text-sm font-semibold truncate">{channel.name}</p>
        <p className="text-white/50 text-[11px] truncate uppercase tracking-wider mt-0.5">
          {channel.categories?.[0] || "TV"}
        </p>
      </div>
    </button>
  );
}
