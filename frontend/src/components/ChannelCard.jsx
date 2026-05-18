import { useState, memo } from "react";
import { Tv, Eye } from "lucide-react";
import FavoriteButton from "@/components/FavoriteButton";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

// Source -> short uppercase label shown on each card
const SOURCE_TAGS = {
  basic: "BASIC",
  cable: "CABLE",
  satellite: "SAT",
  terrestrial: "DVB-T",
  iptv: "IPTV",
};

// Quality tag styling
const QUALITY_LABELS = {
  "4K": { label: "4K", cls: "q-4k" },
  UHD: { label: "UHD", cls: "q-4k" },
  FHD: { label: "FHD", cls: "q-fhd" },
  HD: { label: "HD", cls: "q-hd" },
};

function ChannelCard({ channel, onClick }) {
  const [imgError, setImgError] = useState(!channel.logo);

  const logoSrc = channel.logo
    ? (channel.logo.startsWith("http") ? channel.logo : `${BACKEND_URL}${channel.logo}`)
    : "";

  const sourceTag = SOURCE_TAGS[channel.source];
  const quality = channel.quality && QUALITY_LABELS[channel.quality];
  const viewers = channel.viewers || 0;

  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      role="button"
      tabIndex={0}
      className="channel-card channel-card-solid text-left cursor-pointer"
      data-testid={`channel-card-${channel.id}`}
      aria-label={`Lancer ${channel.name}`}
    >
      <div className="absolute top-3 left-3 z-10">
        <FavoriteButton channelId={channel.id} size={14} />
      </div>

      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        {sourceTag && (
          <span className={`source-tag source-${channel.source}`} data-testid={`source-tag-${channel.source}`}>
            {sourceTag}
          </span>
        )}
        {quality && (
          <span className={`quality-tag ${quality.cls}`} data-testid={`quality-tag-${channel.quality}`}>
            {quality.label}
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
            alt=""
            className="channel-logo"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <Tv size={42} className="text-white/30" strokeWidth={1.4} />
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 px-3 py-2.5 bg-gradient-to-t from-black/95 via-black/70 to-transparent">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-white text-sm font-semibold truncate flex-1">{channel.name}</p>
          {viewers > 0 && (
            <span
              className="viewers-badge"
              data-testid={`viewers-count-${channel.id}`}
              title={`${viewers} spectateur${viewers > 1 ? "s" : ""} actuellement`}
            >
              <Eye size={11} />
              {viewers}
            </span>
          )}
        </div>
        <p className="text-white/50 text-[11px] truncate uppercase tracking-wider">
          {channel.categories?.[0] || "TV"}
        </p>
      </div>
    </div>
  );
}

export default memo(ChannelCard);
