import { useEffect, useRef, useState, useCallback } from "react";
import axios from "axios";
import Hls from "hls.js";
import {
  X, Maximize, Minimize, Volume2, VolumeX, Play, Pause,
  RotateCcw, Activity, BarChart3, Loader2, Radio, AlertTriangle,
} from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// AES-CBC key/IV reverse-engineered from /statics/*.js of the Jack07 SPA.
// The Jack07 CDN gates segment authentication behind `/token-<aes>/...`.
// We do the AES IN THE BROWSER because the segment CDN edge is geo-locked
// to the user's IP — a server-side proxy gets 403 on segments even when the
// manifest itself returns 200.
const _AES_KEY = new Uint8Array([0xa7,0x98,0x1c,0xc9,0xeb,0x2f,0x4d,0x19,0xdc,0xfe,0xa5,0x7b,0x10,0x1e,0xcd,0x89]);
const _AES_IV  = new Uint8Array([0x80,0x17,0xd3,0xa8,0xf1,0x40,0x0d,0x2f,0,0,0,0,0,0,0,0]);

function _rot47(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const n = s.charCodeAt(i);
    if (n >= 33 && n <= 126) out += String.fromCharCode(33 + ((n - 33 + 47) % 94));
    else out += s[i];
  }
  return out;
}

// Minimal protobuf reader — we only need length-delimited (wire type 2) and
// varint (0). Sufficient to walk to field 10.2.4 in the /stream/detail body.
function _pbReadVarint(buf, pos) {
  let n = 0, s = 0, i = pos;
  while (i < buf.length) {
    const b = buf[i++];
    n |= (b & 0x7F) << s;
    if (!(b & 0x80)) return { value: n, pos: i };
    s += 7;
  }
  return { value: n, pos: i };
}
function _pbFindField(buf, fieldNumber) {
  let pos = 0;
  while (pos < buf.length) {
    const t = _pbReadVarint(buf, pos);
    pos = t.pos;
    const fnum = t.value >>> 3;
    const wire = t.value & 7;
    if (wire === 2) {
      const L = _pbReadVarint(buf, pos);
      const len = L.value;
      pos = L.pos;
      const slice = buf.subarray(pos, pos + len);
      pos += len;
      if (fnum === fieldNumber) return slice;
    } else if (wire === 0) {
      pos = _pbReadVarint(buf, pos).pos;
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 5) {
      pos += 4;
    } else {
      break;
    }
  }
  return null;
}
function _bytesToLatin1(buf) {
  let s = "";
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return s;
}

async function _aesEncryptB64(plaintext) {
  const enc = new TextEncoder().encode(plaintext);
  const key = await crypto.subtle.importKey("raw", _AES_KEY, { name: "AES-CBC" }, false, ["encrypt"]);
  // SubtleCrypto AES-CBC auto-applies PKCS7 — pass raw plaintext.
  const ct = await crypto.subtle.encrypt({ name: "AES-CBC", iv: _AES_IV }, key, enc);
  let bin = "";
  const u8 = new Uint8Array(ct);
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

/**
 * Calls /api/stream/detail directly, extracts the ROT47-protected m3u8 URL,
 * AES-encrypts the rb-session header into a `/token-<aes>/` prefix and
 * returns the playable, IP-bound m3u8 URL. Throws on any failure.
 */
async function resolveJack07Stream(apiUrl) {
  const r = await fetch(apiUrl, { method: "GET", credentials: "omit" });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const rbSession = r.headers.get("rb-session") || r.headers.get("Rb-Session");
  if (!rbSession) throw new Error("rb-session header missing");
  const buf = new Uint8Array(await r.arrayBuffer());

  // Walk fields: 10 → 2 → 4. Each is wire-type 2 (length-delimited).
  const f10 = _pbFindField(buf, 10);
  if (!f10) throw new Error("pb field 10 missing");
  const f10_2 = _pbFindField(f10, 2);
  if (!f10_2) throw new Error("pb field 10.2 missing");
  const f10_2_4 = _pbFindField(f10_2, 4);
  if (!f10_2_4) throw new Error("pb field 10.2.4 missing");

  const encStr = _bytesToLatin1(f10_2_4);
  const decoded = _rot47(encStr);
  if (decoded.length < 8) throw new Error("decoded too short");
  const cleanUrl = decoded.slice(8);
  if (!/^https?:\/\//i.test(cleanUrl)) throw new Error("not a URL");

  const tokenB64 = await _aesEncryptB64(rbSession);
  // encodeURIComponent — must encode "/" so urljoin in the player doesn't
  // mis-parse the path. Append the trailing "a" the SPA does (length byte).
  const token = encodeURIComponent(tokenB64) + "a";
  const u = new URL(cleanUrl);
  return `${u.protocol}//${u.host}/token-${token}${u.pathname}${u.search}`;
}

/**
 * Jack07 TV playback overlay. Resolves streams CLIENT-SIDE (see comments
 * above) and feeds the IP-bound m3u8 URL to hls.js. Falls back to the
 * Jack07 iframe player if resolution or playback fails.
 */
export default function Jack07Overlay({ match, detail: initialDetail, onClose }) {
  const sportType = match?.sport_type || initialDetail?.sport_type || 1;
  const [detail, setDetail] = useState(initialDetail || null);
  const [streams, setStreams] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState([]);
  const [loadingStreams, setLoadingStreams] = useState(true);
  const [streamError, setStreamError] = useState(null);
  // Default to iframe — the Jack07 segment CDN enforces a Referer check
  // that's impossible to satisfy from our origin. The iframe loads from
  // jack07eo.* (correct referrer) so segments authenticate properly.
  const [mode, setMode] = useState("iframe");

  const matchId = match?.id || detail?.id;

  // Fetch full detail (kept fresh in case prefetch was stale)
  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API}/jack07/detail/${matchId}`, { params: { sport: sportType } });
        if (!cancelled) setDetail(r.data);
      } catch { /* keep prefetch */ }
    })();
    return () => { cancelled = true; };
  }, [matchId, sportType]);

  // Fetch stream sources (with upstream api_url for client-side resolve)
  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    (async () => {
      setLoadingStreams(true);
      setStreamError(null);
      try {
        const r = await axios.get(`${API}/jack07/streams/${matchId}`, { params: { sport: sportType } });
        if (cancelled) return;
        const list = (r.data?.streams || []).filter((s) => s.manifest_url || s.api_url);
        if (!list.length) {
          setStreamError("Aucune source disponible pour ce match");
          setStreams([]);
        } else {
          setStreams(list);
          setActiveId(list[0].id);
        }
      } catch {
        if (!cancelled) setStreamError("Impossible de charger les sources");
      } finally {
        if (!cancelled) setLoadingStreams(false);
      }
    })();
    return () => { cancelled = true; };
  }, [matchId, sportType]);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [e, s] = await Promise.all([
          axios.get(`${API}/jack07/events/${matchId}`, { params: { sport: sportType } }),
          axios.get(`${API}/jack07/stats/${matchId}`, { params: { sport: sportType } }),
        ]);
        if (cancelled) return;
        setEvents(e.data?.events || []);
        setStats(s.data?.stats || []);
      } catch { /* silent */ }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [matchId, sportType]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 3-second auto-fallback to iframe if native mode is selected and no
  // source resolves — defensive even though iframe is default now.
  useEffect(() => {
    if (mode !== "native" || loadingStreams) return;
    if (streamError && (detail?.site_url || match?.site_url)) {
      const t = setTimeout(() => setMode("iframe"), 3000);
      return () => clearTimeout(t);
    }
  }, [streamError, loadingStreams, mode, detail?.site_url, match?.site_url]);

  const handleFatal = useCallback(() => {
    if (detail?.site_url || match?.site_url) setMode("iframe");
  }, [detail?.site_url, match?.site_url]);

  const activeStream = streams?.find((s) => s.id === activeId) || streams?.[0];
  const siteUrl = detail?.site_url || match?.site_url || "";

  const homeName = detail?.home?.name || match?.home?.name || "";
  const awayName = detail?.away?.name || match?.away?.name || "";
  const homeLogo = detail?.home?.logo || match?.home?.logo || "";
  const awayLogo = detail?.away?.logo || match?.away?.logo || "";
  const hs = detail?.home_score ?? match?.home_score;
  const as = detail?.away_score ?? match?.away_score;
  const statusLabel = detail?.status_label || match?.status_label || "";
  const leagueName = detail?.league?.name || match?.league?.name || "";
  const sportLabel = detail?.sport || match?.sport || "";
  const sourcesCount = streams?.length ?? 0;

  return (
    <div className="fixed inset-0 z-[80] bg-black/95 backdrop-blur-md overflow-y-auto" data-testid="jack07-overlay">
      <div className="min-h-full flex flex-col">
        <div className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 bg-black/80 backdrop-blur border-b border-white/10">
          <div className="min-w-0 flex-1">
            <div className="text-white font-extrabold text-sm truncate" data-testid="jack07-title">
              {match?.title || `${homeName} vs ${awayName}`}
            </div>
            <div className="text-white/55 text-[11px] truncate flex items-center gap-2">
              {sportLabel && (
                <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold uppercase tracking-wide" data-testid="jack07-sport-badge">
                  {sportLabel}
                </span>
              )}
              {leagueName ? <span>{leagueName}</span> : null}
              {statusLabel && (
                <span className="inline-flex items-center gap-1 text-red-400 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  {statusLabel}
                </span>
              )}
              {sourcesCount > 0 && (
                <span className="text-amber-400 font-semibold" data-testid="jack07-sources-count">
                  {sourcesCount} source{sourcesCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="iframe-player-btn iframe-player-btn-close" title="Fermer" data-testid="jack07-close">
            <X size={16} />
          </button>
        </div>

        <div className="px-4 pt-4 pb-10">
          <div className="mx-auto max-w-6xl space-y-4">
            {mode === "native" ? (
              <Jack07Player
                manifestUrl={activeStream?.manifest_url}
                apiUrl={activeStream?.api_url}
                loading={loadingStreams}
                error={streamError}
                channelName={activeStream?.name || ""}
                onFatalError={handleFatal}
              />
            ) : (
              <Jack07Iframe siteUrl={siteUrl} onBackToNative={() => setMode("native")} />
            )}

            {siteUrl && (
              <div className="flex justify-center">
                <button
                  onClick={() => setMode((m) => (m === "native" ? "iframe" : "native"))}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/15 text-white/75 text-[11px] font-semibold hover:bg-white/10 transition"
                  data-testid="jack07-toggle-mode"
                >
                  {mode === "iframe" ? "Essayer la lecture directe" : "Revenir au lecteur Jack07"}
                </button>
              </div>
            )}

            {mode === "native" && streams && streams.length > 0 && (
              <div className="glass rounded-2xl p-3" data-testid="jack07-servers">
                <div className="text-white/60 text-[11px] font-semibold tracking-wide mb-2 px-1">
                  AUTRES SOURCES ({streams.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {streams.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setActiveId(s.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
                        s.id === activeId
                          ? "bg-amber-500 text-black border-amber-400 shadow-md"
                          : "bg-white/5 text-white/85 border-white/10 hover:bg-white/10"
                      }`}
                      data-testid={`jack07-server-${s.id}`}
                    >
                      {s.id === activeId && <Radio size={11} className="inline mr-1 -mt-0.5" />}
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(homeName || awayName) && (
              <div className="glass rounded-2xl p-4 flex items-center justify-around gap-4">
                <div className="flex flex-col items-center gap-2 min-w-0 flex-1">
                  {homeLogo ? (
                    <img src={homeLogo} alt="" className="w-12 h-12 object-contain" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                  ) : null}
                  <span className="text-white font-bold text-sm text-center truncate max-w-full px-2">{homeName}</span>
                </div>
                <div className="flex flex-col items-center">
                  <div className="text-3xl font-black text-white tabular-nums">
                    {hs != null && as != null ? `${hs} - ${as}` : "VS"}
                  </div>
                  {statusLabel && (
                    <div className="text-[11px] text-red-400 font-bold tracking-wide mt-1">{statusLabel}</div>
                  )}
                </div>
                <div className="flex flex-col items-center gap-2 min-w-0 flex-1">
                  {awayLogo ? (
                    <img src={awayLogo} alt="" className="w-12 h-12 object-contain" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                  ) : null}
                  <span className="text-white font-bold text-sm text-center truncate max-w-full px-2">{awayName}</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <section className="glass rounded-2xl p-4" data-testid="jack07-events-panel">
                <h3 className="text-white font-extrabold mb-3 flex items-center gap-2">
                  <Activity size={16} className="text-red-400" /> Événements ({events.length})
                </h3>
                {events.length === 0 ? (
                  <div className="text-white/50 text-sm">Aucun événement pour le moment.</div>
                ) : (
                  <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                    {events.map((ev, i) => <EventRow key={i} ev={ev} />)}
                  </ul>
                )}
              </section>
              <section className="glass rounded-2xl p-4" data-testid="jack07-stats-panel">
                <h3 className="text-white font-extrabold mb-3 flex items-center gap-2">
                  <BarChart3 size={16} className="text-amber-400" /> Statistiques
                </h3>
                {stats.length === 0 ? (
                  <div className="text-white/50 text-sm">Statistiques indisponibles.</div>
                ) : (
                  <ul className="space-y-3">
                    {stats.map((s, i) => <StatRow key={i} s={s} />)}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * hls.js-backed player. Tries the SERVER-PROXIED manifest first
 * (`manifestUrl` — m3u8 served from our origin so ad-blockers don't drop
 * the foreign upstream host), then falls back to CLIENT-SIDE resolution
 * (`apiUrl` → ROT47 + AES). Bubbles up via `onFatalError` on persistent
 * failures so the parent flips to the iframe player.
 */
function Jack07Player({ manifestUrl, apiUrl, loading, error, channelName, onFatalError }) {
  const videoRef = useRef(null);
  const wrapRef = useRef(null);
  const hlsRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [fs, setFs] = useState(false);
  const [playerErr, setPlayerErr] = useState(null);
  const [buffering, setBuffering] = useState(false);

  useEffect(() => {
    if ((!manifestUrl && !apiUrl) || !videoRef.current) return;
    let cancelled = false;
    const video = videoRef.current;
    setPlayerErr(null);
    setBuffering(true);

    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch { /* noop */ }
      hlsRef.current = null;
    }

    // Hard 8-second fallback in case the manifest fetch silently hangs
    // (uBlock / CSP / network) — without this, hls.js timeouts can take
    // up to 12 s × retries before fataling.
    const fatalTimer = setTimeout(() => {
      if (cancelled) return;
      setPlayerErr("Délai dépassé — bascule vers le lecteur Jack07…");
      setBuffering(false);
      if (typeof onFatalError === "function") onFatalError();
    }, 8000);

    const fail = (msg) => {
      if (cancelled) return;
      clearTimeout(fatalTimer);
      setPlayerErr(msg);
      setBuffering(false);
      if (typeof onFatalError === "function") setTimeout(() => onFatalError(), 600);
    };

    (async () => {
      let m3u8Url = null;
      // Strategy 1: server-proxied manifest (our origin, no adblock issue)
      if (manifestUrl) {
        m3u8Url = manifestUrl.startsWith("http")
          ? manifestUrl
          : `${process.env.REACT_APP_BACKEND_URL}${manifestUrl}`;
      }
      // Strategy 2: client-side AES + ROT47 resolve (legacy)
      if (!m3u8Url && apiUrl) {
        try {
          m3u8Url = await resolveJack07Stream(apiUrl);
        } catch {
          fail("Source indisponible — bascule vers le lecteur Jack07…");
          return;
        }
      }
      if (cancelled || !m3u8Url) return;

      const playPromise = () =>
        video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      const onReady = () => { if (!cancelled) { clearTimeout(fatalTimer); setBuffering(false); playPromise(); } };

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = m3u8Url;
        video.addEventListener("loadeddata", onReady, { once: true });
        return;
      }

      if (!Hls.isSupported()) {
        fail("HLS non supporté par ce navigateur");
        return;
      }

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 8,
        manifestLoadingTimeOut: 6000,
        manifestLoadingMaxRetry: 1,
        fragLoadingTimeOut: 12000,
        fragLoadingMaxRetry: 3,
      });
      hlsRef.current = hls;
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(m3u8Url));
      hls.on(Hls.Events.MANIFEST_PARSED, onReady);
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal || cancelled) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          try { hls.recoverMediaError(); } catch { fail("Erreur média"); }
        } else {
          fail("Flux indisponible — bascule vers le lecteur Jack07…");
        }
      });
    })();

    return () => {
      cancelled = true;
      clearTimeout(fatalTimer);
      if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* noop */ } hlsRef.current = null; }
    };
  }, [manifestUrl, apiUrl, onFatalError]);

  useEffect(() => {
    const onFs = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().then(() => setPlaying(true)).catch(() => {});
    else { v.pause(); setPlaying(false); }
  };
  const toggleMute = () => { const v = videoRef.current; if (!v) return; v.muted = !v.muted; setMuted(v.muted); };
  const toggleFs = () => {
    const el = wrapRef.current; if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  };
  const reload = () => {
    const v = videoRef.current; if (!v) return;
    if (hlsRef.current) hlsRef.current.startLoad();
    v.play().catch(() => {});
  };

  return (
    <div
      ref={wrapRef}
      className="relative w-full rounded-2xl overflow-hidden bg-black border border-white/10"
      style={{ aspectRatio: "16 / 9" }}
    >
      <video
        ref={videoRef}
        playsInline
        muted={muted}
        className="absolute inset-0 w-full h-full"
        data-testid="jack07-video"
      />
      {(loading || buffering) && !playerErr && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none">
          <Loader2 className="animate-spin text-amber-400" size={28} />
          <span className="ml-3 text-white/80 text-sm">{loading ? "Recherche des sources…" : "Connexion au flux…"}</span>
        </div>
      )}
      {(error || playerErr) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-6 text-center">
          <AlertTriangle className="text-amber-400 mb-2" size={28} />
          <div className="text-white font-semibold text-sm">{error || playerErr}</div>
          <div className="text-white/50 text-[11px] mt-1">Essayez une autre source ou le lecteur Jack07.</div>
        </div>
      )}
      {channelName && !loading && !error && (
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur text-white text-[11px] font-semibold border border-white/15">
          {channelName}
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 px-3 py-2 bg-gradient-to-t from-black/80 to-transparent">
        <button onClick={togglePlay} className="iframe-player-btn" title={playing ? "Pause" : "Lecture"} data-testid="jack07-play">
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button onClick={toggleMute} className="iframe-player-btn" title="Son" data-testid="jack07-mute">
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
        <button onClick={reload} className="iframe-player-btn" title="Recharger" data-testid="jack07-reload">
          <RotateCcw size={14} />
        </button>
        <div className="flex-1" />
        <button onClick={toggleFs} className="iframe-player-btn" title="Plein écran" data-testid="jack07-fs">
          {fs ? <Minimize size={14} /> : <Maximize size={14} />}
        </button>
      </div>
    </div>
  );
}

function Jack07Iframe({ siteUrl, onBackToNative }) {
  const iframeRef = useRef(null);
  const wrapRef = useRef(null);
  const buildSrcRef = useRef(null);
  const [fs, setFs] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const buildSrc = useCallback(() => {
    if (!siteUrl) return "about:blank";
    const base = siteUrl.split("#")[0];
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}autoplay=1&muted=1&_t=${Date.now()}`;
  }, [siteUrl]);

  // Stable initial src — only compute once when siteUrl is available.
  if (buildSrcRef.current == null && siteUrl) {
    buildSrcRef.current = buildSrc();
  }

  useEffect(() => {
    const onFs = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Responsive: scale so the player rectangle (765-px-wide on Jack07's
  // 1280-px desktop layout) fills the wrapper width.
  useEffect(() => {
    const wrap = wrapRef.current;
    const ifr = iframeRef.current;
    if (!wrap || !ifr) return;
    const apply = () => {
      const w = wrap.clientWidth || 765;
      ifr.style.setProperty("--ifrScale", String(w / 765));
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [loaded]);

  if (!siteUrl) {
    return (
      <div className="relative w-full rounded-2xl overflow-hidden bg-black border border-white/10 flex items-center justify-center text-white/60" style={{ aspectRatio: "16 / 9" }}>
        Aucune source disponible.
      </div>
    );
  }

  const reload = () => {
    const ifr = iframeRef.current;
    if (!ifr) return;
    setLoaded(false);
    ifr.src = buildSrc();
  };
  const toggleFs = () => {
    const el = wrapRef.current; if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  };

  return (
    <div
      ref={wrapRef}
      className="relative w-full rounded-2xl overflow-hidden bg-black border border-white/10"
      // Aspect-ratio matches the Jack07 player rectangle (765×655) so the
      // crop fills the wrapper exactly with no black bars.
      style={{ aspectRatio: "765 / 655" }}
      data-testid="jack07-iframe-wrap"
    >
      {/*
        We can't inject CSS into a cross-origin iframe to hide chrome, so we
        crop visually: the iframe is sized MUCH larger than its wrapper and
        translated so only the player rectangle on the Jack07 page lands in
        the visible area. The numbers below were tuned against the current
        Jack07 layout (header ~110 CSS-px + match info ~210 CSS-px + player
        ~9:16 box ~720 CSS-px wide on 1280-wide viewport).

        Strategy:
        • Iframe internal viewport width = 1280 CSS-px (forced by `style.width`)
          so the page renders identically regardless of our wrapper width →
          fully responsive.
        • Translate UP by 320 CSS-px (header+match-info) → top of player aligns
          with top of wrapper.
        • Iframe internal height = 1280 * 9 / 16 = 720 px after translate.
        • The wrapper itself is 16/9, so the inner SVG-like surface matches.
        • Side / bottom black masks soften any residual chrome bleed.
      */}
      <iframe
        src={buildSrcRef.current || siteUrl}
        title="Jack07 player"
        className="absolute left-0 top-0"
        style={{
          // From an actual user screenshot of the Jack07 page rendered at
          // 1280-px viewport, the <video> player occupies a FIXED rectangle:
          //   x: 205 → 970   (width 765)
          //   y: 113 → 768   (height 655)
          // The size doesn't change between idle / playing — it's anchored
          // to the page layout. So we render the iframe at 1280×800,
          // clip-path the surface to ONLY that rectangle, translate the
          // rectangle's top-left to (0,0) of the wrapper, and scale so the
          // 765-px-wide player exactly fills the wrapper width.
          //
          // Wrapper aspect-ratio is set to 765:655 (= 1.168) to match the
          // player so nothing else of Jack07's site leaks in.
          width: "1280px",
          height: "800px",
          clipPath: "inset(113px 310px 32px 205px)",
          transform: "translate(-205px, -113px) scale(var(--ifrScale, 1))",
          transformOrigin: "top left",
          border: "none",
          background: "#000",
        }}
        ref={iframeRef}
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write; web-share"
        allowFullScreen
        referrerPolicy="no-referrer-when-downgrade"
        scrolling="no"
        onLoad={() => setLoaded(true)}
        data-testid="jack07-iframe"
      />
      {/* No bottom mask needed — the iframe is sized to stop precisely
          before the Copier URL bar, so nothing of the site chrome leaks. */}
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 pointer-events-none">
          <Loader2 className="animate-spin text-amber-400" size={28} />
          <span className="ml-3 text-white/80 text-sm">Chargement du lecteur…</span>
        </div>
      )}
      <div className="absolute top-2 right-2 flex gap-1 z-10">
        <button onClick={onBackToNative} className="iframe-player-btn" title="Essayer le lecteur natif" data-testid="jack07-try-native">
          <Play size={14} />
        </button>
        <button onClick={reload} className="iframe-player-btn" title="Recharger">
          <RotateCcw size={14} />
        </button>
        <button onClick={toggleFs} className="iframe-player-btn" title="Plein écran">
          {fs ? <Minimize size={14} /> : <Maximize size={14} />}
        </button>
      </div>
    </div>
  );
}

function EventRow({ ev }) {
  const sideColor = ev.side === "home" ? "border-l-emerald-400" : ev.side === "away" ? "border-l-sky-400" : "border-l-white/30";
  const iconBg = ev.kind === 110 ? "bg-yellow-400" : ev.kind === 111 || ev.kind === 112 ? "bg-red-500" : ev.kind === 101 || ev.kind === 102 ? "bg-emerald-500" : "bg-white/20";
  return (
    <li className={`flex items-center gap-3 pl-3 py-1.5 border-l-2 ${sideColor}`}>
      <span className="text-white/80 font-bold text-sm w-10 text-right tabular-nums">{ev.minute || "—"}&apos;</span>
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${iconBg}`} />
      <span className="text-white text-sm flex-1 truncate">
        <span className="font-semibold">{ev.label}</span>
        {ev.player ? <span className="text-white/60"> — {ev.player}</span> : null}
      </span>
      {ev.score && <span className="text-white/60 text-xs tabular-nums">{ev.score}</span>}
    </li>
  );
}

function StatRow({ s }) {
  const h = parseFloat(String(s.home ?? "").replace("%", "")) || 0;
  const a = parseFloat(String(s.away ?? "").replace("%", "")) || 0;
  const total = h + a;
  const hp = total > 0 ? (h / total) * 100 : 50;
  const ap = total > 0 ? (a / total) * 100 : 50;
  return (
    <li>
      <div className="flex items-center justify-between text-xs text-white/80 mb-1">
        <span className="font-semibold tabular-nums">{s.home ?? "—"}</span>
        <span className="text-white/60 truncate px-2 text-center flex-1">{s.label}</span>
        <span className="font-semibold tabular-nums">{s.away ?? "—"}</span>
      </div>
      <div className="flex h-1.5 rounded-full overflow-hidden bg-white/10">
        <div className="bg-emerald-400" style={{ width: `${hp}%` }} />
        <div className="bg-sky-400" style={{ width: `${ap}%` }} />
      </div>
    </li>
  );
}
