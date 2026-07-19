import { useCallback, useEffect, useState } from "react";

// Lightweight "recently watched" tracker (localStorage only, per-device).
// Stores a small snapshot of each channel so we can render a "Continue watching"
// row without re-fetching. Most-recent first, deduped by id, capped at MAX.

const LS_KEY = "livewatch.recent.v1";
const MAX = 14;

function readLS() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeLS(items) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(items));
  } catch (_) {
    /* noop */
  }
}

export function useRecentlyWatched() {
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    setRecent(readLS());
  }, []);

  const record = useCallback((channel) => {
    if (!channel || !channel.id) return;
    const snap = {
      id: channel.id,
      name: channel.name || "",
      logo: channel.logo || "",
      country: channel.country || "",
      source: channel.source || "",
      quality: channel.quality || null,
      categories: Array.isArray(channel.categories) ? channel.categories.slice(0, 2) : [],
      ts: Date.now(),
    };
    setRecent((prev) => {
      const next = [snap, ...prev.filter((c) => c.id !== channel.id)].slice(0, MAX);
      writeLS(next);
      return next;
    });
  }, []);

  const remove = useCallback((id) => {
    setRecent((prev) => {
      const next = prev.filter((c) => c.id !== id);
      writeLS(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    writeLS([]);
    setRecent([]);
  }, []);

  return { recent, record, remove, clear };
}

export default useRecentlyWatched;
