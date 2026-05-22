/**
 * Helpers for calling /api/stream/{id} and /api/daddy/stream/{id} so the
 * backend can:
 *   1) count Members vs Guests (we forward the Supabase JWT when present),
 *   2) count VIPs separately (we forward `?vip=1` when the user has the
 *      ad-free / VIP role),
 *   3) tag embed-page plays (we forward `?embed=1` when the player is
 *      mounted inside /embed/* or inside a 3rd-party iframe),
 *   4) attribute embeds to their parent page (we forward document.referrer
 *      as `?ref=` when the player is loaded inside a 3rd-party iframe).
 */
import axios from "axios";
import { supabase, hasAdFreeExperience } from "@/lib/supabase";

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

/** Best-effort: returns the current user profile (or null) for role checks. */
async function getCurrentProfile() {
  try {
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess?.session?.user?.id;
    if (!uid) return null;
    const { data } = await supabase
      .from("user_profiles")
      .select("id, role, is_vip")
      .eq("id", uid)
      .maybeSingle();
    return data || null;
  } catch {
    return null;
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

/** True when the current page is an embed page (/embed/* or inside iframe). */
export function isEmbedContext() {
  try {
    if (window.self !== window.top) return true;
    const p = window.location.pathname || "";
    return p.startsWith("/embed/") || p.startsWith("/embed-daddy/");
  } catch {
    return false;
  }
}

/** Builds the request config (headers + params) for /api/stream/* calls. */
async function buildStreamRequest({ withRef = true } = {}) {
  const headers = {};
  const token = await getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const params = {};
  if (token) {
    // Only meaningful when we send a Bearer too — backend ignores vip=1
    // when is_member=false anyway, but no need to pollute the wire.
    const profile = await getCurrentProfile();
    if (profile && hasAdFreeExperience(profile)) {
      params.vip = 1;
    }
  }
  if (isEmbedContext()) {
    params.embed = 1;
  }
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
