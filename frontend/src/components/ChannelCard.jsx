import { useState } from "react";
import { Tv } from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

// Source -> short uppercase label shown on each card
const SOURCE_TAGS = {
  basic: "BASIC",
  cable: "CABLE",
  satellite: "SAT",
  terrestrial: "DVB-T",
  iptv: "IPTV",
  hd: "HD",
  fhd: "FHD",
};

export default function ChannelCard({ channel, onClick }) {
  const [imgError, setImgError] = useState(!channel.logo);

  const logoSrc = channel.logo
    ? (channel.logo.startsWith("http") ? channel.logo : `${BACKEND_URL}${channel.logo}`)
    : "";

  const tag = SOURCE_TAGS[channel.source];

  return (
    <button
      onClick={onClick}
      className="channel-card glass reveal text-left"
      data-testid={`channel-card-${channel.id}`}
      aria-label={`Lancer ${channel.name}`}
    >
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        {tag && (
          <span className={`source-tag source-${channel.source}`} data-testid={`source-tag-${channel.source}`}>
            {tag}
          </span>
        )}
        <span className="live-badge">
          <span className="dot" />
          Live
        </span>
      </div>

      <div className="absolute inset-0 flex items-center justify-center p-4">
        {!imgError && logoSrc ? (
          <img
            src={logoSrc}
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
