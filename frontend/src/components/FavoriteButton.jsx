import { memo } from "react";
import { Heart } from "lucide-react";
import { useFavorites } from "@/hooks/useFavorites";

function FavoriteButton({ channelId, size = 14, className = "", stopPropagation = true }) {
  const { isFavorite, toggle } = useFavorites();
  const fav = isFavorite(channelId);

  const onClick = (e) => {
    if (stopPropagation) {
      e.stopPropagation();
      e.preventDefault();
    }
    toggle(channelId);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`fav-btn ${fav ? "is-fav" : ""} ${className}`}
      aria-label={fav ? "Retirer des favoris" : "Ajouter aux favoris"}
      title={fav ? "Retirer des favoris" : "Ajouter aux favoris"}
      data-testid={`fav-btn-${channelId}`}
    >
      <Heart
        size={size}
        fill={fav ? "#ff2e63" : "transparent"}
        strokeWidth={fav ? 0 : 2}
        color={fav ? "#ff2e63" : "currentColor"}
      />
    </button>
  );
}

export default memo(FavoriteButton);
