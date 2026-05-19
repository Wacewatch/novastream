import { Globe2 } from "lucide-react";
import { flagUrl, countryToCode } from "@/lib/flags";

/**
 * <FlagIcon country="France" /> renders a flagcdn flag image with proper
 * aspect ratio. Falls back to a Globe icon when the country has no mapping.
 *
 * Props:
 *  - country: country name (English or French)
 *  - size: tailwind-style "w-N h-N" classes OR a number in px (default 16)
 *  - className: extra classes to add on the wrapper
 *  - rounded: bool — round corners (default true)
 *  - title: optional tooltip override (defaults to country name)
 */
export default function FlagIcon({
  country,
  size = 16,
  className = "",
  rounded = true,
  title,
}) {
  const code = countryToCode(country);
  const url = flagUrl(country, "24x18");
  const dpr2x = flagUrl(country, "48x36");

  const px = typeof size === "number" ? size : null;
  const style = px
    ? { width: px, height: Math.round((px * 18) / 24) }
    : undefined;

  if (!url || !code) {
    return (
      <span
        className={`inline-flex items-center justify-center text-white/40 ${className}`}
        style={style}
        title={title || country || ""}
      >
        <Globe2 size={px ? Math.max(10, px - 4) : 12} />
      </span>
    );
  }

  return (
    <img
      src={url}
      srcSet={dpr2x ? `${dpr2x} 2x` : undefined}
      width={px || undefined}
      height={px ? Math.round((px * 18) / 24) : undefined}
      alt={country || code.toUpperCase()}
      title={title || country || ""}
      loading="lazy"
      decoding="async"
      draggable={false}
      style={style}
      className={`inline-block object-cover shrink-0 ${rounded ? "rounded-[2px]" : ""} ${className}`}
    />
  );
}
