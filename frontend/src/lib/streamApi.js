/**
 * Helpers for calling /api/stream/{id} and /api/daddy/stream/{id} so the
 * backend can:
 *   1) count Members vs Guests (we forward the Supabase JWT when present),
 *   2) attribute embeds to their parent page (we forward document.referrer
 *      as `?ref=` when the player is loaded inside a 3rd-party iframe).
 */
import axios from "axios";
import { supabase } from "@/lib/supabase";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/** Returns the current Supabase access token, or "" if not logged in. */
export async function getAccessToken() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || "";
  } catch {
    return "";
  }
}

/**
 * Returns the "parent" page URL when we are running inside an iframe (e.g.
 * livewatch.top/embed/123 embedded by wavewatch.top). When NOT in an iframe
 * or when document.referrer is empty (Referrer-Policy: no-referrer), returns
 * "". This is what we forward to the backend as `?ref=…`.
 */
export function getParentReferrer() {
  try {
    const inIframe = window.self !== window.top;
    if (!inIframe) return "";
    const ref = document.referrer || "";
    // Don't echo our own origin (would just duplicate the iframe URL).
    if (!ref) return "";
    try {
      const r = new URL(ref);
      const own = new URL(window.location.href);
      if (r.host === own.host) return "";
    } catch {
      /* ignore */
    }
    return ref;
  } catch {
    return "";
  }
}

/** Builds the request config (headers + params) for /api/stream/* calls. */
async function buildStreamRequest({ withRef = true } = {}) {
  const headers = {};
  const token = await getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const params = {};
  if (withRef) {
    const ref = getParentReferrer();
    if (ref) params.ref = ref;
  }
  return { headers, params };
}

/** TV — GET /api/stream/{channelId} */
export async function fetchTvStream(channelId) {
  const cfg = await buildStreamRequest();
  const r = await axios.get(`${API}/stream/${encodeURIComponent(channelId)}`, cfg);
  return r.data;
}

/** DaddyTV — GET /api/daddy/stream/{channelId} */
export async function fetchDaddyStream(channelId) {
  const cfg = await buildStreamRequest();
  const r = await axios.get(`${API}/daddy/stream/${encodeURIComponent(channelId)}`, cfg);
  return r.data;
}
