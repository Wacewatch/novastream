import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

const FavoritesContext = createContext(null);
const LS_KEY = "livewatch.favorites.v1";

function readLS() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}
function writeLS(ids) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ids));
  } catch (_) {
    /* noop */
  }
}

export function FavoritesProvider({ children }) {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState(() => readLS());
  const [loading, setLoading] = useState(true);
  const lastSyncedUserId = useRef(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      if (user?.id) {
        const { data, error } = await supabase
          .from("user_favorites")
          .select("channel_id")
          .eq("user_id", user.id);
        if (error) throw new Error(error.message);
        const ids = (data || []).map((r) => r.channel_id);
        setFavorites(ids);
        writeLS(ids);
      } else {
        setFavorites(readLS());
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[favorites] reload error", e?.message || e);
      setFavorites(readLS());
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  // On first login (user.id changes from null to a value), merge local -> remote
  useEffect(() => {
    (async () => {
      if (!user?.id) return;
      if (lastSyncedUserId.current === user.id) return;
      lastSyncedUserId.current = user.id;
      const local = readLS();
      if (!local || local.length === 0) return;
      try {
        const rows = local.map((channel_id) => ({
          user_id: user.id,
          channel_id,
        }));
        await supabase.from("user_favorites").upsert(rows, {
          onConflict: "user_id,channel_id",
          ignoreDuplicates: true,
        });
        await reload();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[favorites] merge sync error", e?.message || e);
      }
    })();
  }, [user?.id, reload]);

  const toggle = useCallback(
    async (channelId) => {
      if (!channelId) return;
      let willBeFavorite = false;
      setFavorites((prev) => {
        const isFav = prev.includes(channelId);
        willBeFavorite = !isFav;
        const next = isFav ? prev.filter((id) => id !== channelId) : [...prev, channelId];
        writeLS(next);
        return next;
      });
      try {
        if (user?.id) {
          if (!willBeFavorite) {
            const { error } = await supabase
              .from("user_favorites")
              .delete()
              .eq("user_id", user.id)
              .eq("channel_id", channelId);
            if (error) throw new Error(error.message);
          } else {
            const { error } = await supabase
              .from("user_favorites")
              .insert({ user_id: user.id, channel_id: channelId });
            if (error && error.code !== "23505") throw new Error(error.message);
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[favorites] toggle error", e?.message || e);
        // revert
        setFavorites((prev) => {
          const next = willBeFavorite
            ? prev.filter((id) => id !== channelId)
            : [...prev, channelId];
          writeLS(next);
          return next;
        });
      }
    },
    [user?.id]
  );

  const isFavorite = useCallback((id) => favorites.includes(id), [favorites]);

  const value = useMemo(
    () => ({
      favorites,
      loading,
      isFavorite,
      toggle,
      reload,
      count: favorites.length,
    }),
    [favorites, loading, isFavorite, toggle, reload]
  );

  return (
    <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) {
    throw new Error("useFavorites must be used within FavoritesProvider");
  }
  return ctx;
}
