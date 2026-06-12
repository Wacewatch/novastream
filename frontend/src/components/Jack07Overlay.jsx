import { useEffect, useRef, useState } from "react";
import axios from "axios";
import Hls from "hls.js";
import {
  X, Maximize, Minimize, Volume2, VolumeX, Play, Pause,
  RotateCcw, Activity, BarChart3, Loader2, Radio, AlertTriangle,
} from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Jack07 TV playback overlay.
 *
 * Tries to play directly via hls.js using the m3u8 URL returned by
 * /api/jack07/streams. If hls.js can't reach the segments (the upstream
 * CDN binds them to the rb-session/IP that resolved /api/stream/detail —
 * which is our backend, not the user's browser — and rejects mismatches
 * with HTTP 487), we transparently fall back to iframing Jack07's own
 * player page, which carries the right session in JS state.
 *
 * Layout:
 *   - Sticky top bar (match title + close + native/iframe toggle)
 *   - 16:9 player area (native OR iframe)
 *   - Server picker row (only in native mode)
 *   - Score banner
 *   - Two-column info panel: events (live), stats
 */
export default function Jack07Overlay({ match, detail: initialDetail, onClose }) {
  const [detail, setDetail] = useState(initialDetail || null);
  const [streams, setStreams] = useState(null); // [{ id, name, stream_url, available }]
  const [activeId, setActiveId] = useState(null);
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState([]);
  const [loadingStreams, setLoadingStreams] = useState(true);
  const [streamError, setStreamError] = useState(null);
  // Playback mode: 'native' (hls.js) or 'iframe' (fallback). Auto-switches
  // to iframe when hls.js reports a fatal NETWORK_ERROR (segment 487).
  const [mode, setMode] = useState("native");

  const matchId = match?.id || detail?.id;

  // 1) Always fetch detail (refresh from server) for fresh score/status
  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API}/jack07/detail/${matchId}`);
        if (!cancelled) setDetail(r.data);
      } catch { /* keep initial */ }
    })();
    return () => { cancelled = true; };
  }, [matchId]);

  // 2) Load streams metadata (browser does the actual resolution)
  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    (async () => {
      setLoadingStreams(true);
      setStreamError(null);
      try {
        const r = await axios.get(`${API}/jack07/streams/${matchId}`);
        if (cancelled) return;
        const list = (r.data?.streams || []).filter((s) => s.api_url);
        if (!list.length) {
          setStreamError("Aucune source disponible pour ce match");
          setStreams([]);
          setLoadingStreams(false);
          return;
        }
        setStreams(list);
        setActiveId(list[0].id);
      } catch (e) {
        if (!cancelled) setStreamError("Impossible de charger les sources");
      } finally {
        if (!cancelled) setLoadingStreams(false);
      }
    })();
    return () => { cancelled = true; };
  }, [matchId]);

  // 3) Poll events + stats every 15 s
  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [e, s] = await Promise.all([
          axios.get(`${API}/jack07/events/${matchId}`),
          axios.get(`${API}/jack07/stats/${matchId}`),
        ]);
        if (cancelled) return;
        setEvents(e.data?.events || []);
        setStats(s.data?.stats || []);
      } catch { /* silent */ }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [matchId]);

  // 4) ESC to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  return (
    <div className="fixed inset-0 z-[80] bg-black/95 backdrop-blur-md overflow-y-auto" data-testid="jack07-overlay">
      <div className="min-h-full flex flex-col">
        {/* ===== Top bar ===== */}
        <div className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 bg-black/80 backdrop-blur border-b border-white/10">
          <div className="min-w-0 flex-1">
            <div className="text-white font-extrabold text-sm truncate" data-testid="jack07-title">
              {match?.title || `${homeName} vs ${awayName}`}
            </div>
            <div className="text-white/55 text-[11px] truncate flex items-center gap-2">
              {leagueName ? <span>{leagueName}</span> : null}
              {statusLabel && (
                <span className="inline-flex items-center gap-1 text-red-400 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  {statusLabel}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="iframe-player-btn iframe-player-btn-close" title="Fermer" data-testid="jack07-close">
            <X size={16} />
          </button>
        </div>

        {/* ===== Player + info column ===== */}
        <div className="px-4 pt-4 pb-10">
          <div className="mx-auto max-w-6xl space-y-4">
            {/* ===== Player ===== */}
            {mode === "native" ? (
              <Jack07Player
                apiUrl={activeStream?.api_url}
                loading={loadingStreams}
                error={streamError}
                channelName={activeStream?.name || ""}
                onFatalError={() => siteUrl && setMode("iframe")}
              />
            ) : (
              <Jack07Iframe siteUrl={siteUrl} onBackToNative={() => setMode("native")} />
            )}

            {/* ===== Mode toggle — VISIBLE button per user request ===== */}
            {siteUrl && (
              <div className="flex justify-center">
                <button
                  onClick={() => setMode((m) => (m === "native" ? "iframe" : "native"))}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/15 text-white/85 text-xs font-semibold hover:bg-white/10 transition"
                  data-testid="jack07-toggle-mode"
                >
                  {mode === "native" ? (
                    <>Basculer sur le lecteur Jack07 (iframe)</>
                  ) : (
                    <>Revenir au lecteur direct (natif)</>
                  )}
                </button>
              </div>
            )}

            {/* ===== Server picker (native mode only — iframe has its own picker) ===== */}
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

            {/* ===== Score banner ===== */}
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

            {/* ===== Info: events + stats ===== */}
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

// =====================================================================
// Jack07 cipher helpers — reversed from /statics/*.js bundles
// =====================================================================

/** ROT47: each printable ASCII char shifted by 47 (range 33-126). */
function rot47(s) {
  let out = "";
  for (const c of s) {
    const n = c.charCodeAt(0);
    out += (n >= 33 && n <= 126) ? String.fromCharCode(33 + ((n - 33 + 47) % 94)) : c;
  }
  return out;
}

/**
 * Extract the m3u8 URL from the /api/stream/detail protobuf body.
 * The URL lives at path (10, 2, 4) as a ROT47-encrypted string with an
 * 8-byte garbage prefix. We don't need a full PB decoder — we just locate
 * the ROT47 signature of "https://" inside the body and walk forward.
 */
function extractM3u8FromPb(bytes) {
  let txt = "";
  for (let i = 0; i < bytes.length; i++) txt += String.fromCharCode(bytes[i]);
  // ROT47 of 'https://' = '9EEADi^^'
  const idx = txt.indexOf("9EEADi^^");
  if (idx < 0) return null;
  const start = Math.max(0, idx - 8);
  let end = idx;
  while (end < txt.length) {
    const code = txt.charCodeAt(end);
    if (code < 33 || code > 126) break;
    end++;
  }
  const enc = txt.slice(start, end);
  const dec = rot47(enc);
  if (dec.length < 8) return null;
  const url = dec.slice(8);
  return url.toLowerCase().startsWith("http") ? url : null;
}

/**
 * Encrypt rb-session header → AES-128-CBC token. Key & IV are baked into
 * the Jack07 SPA bundle (`/statics/c6e43a94890.js` and friends).
 * Returns the URI-encoded base64 ciphertext + 'a' suffix.
 */
async function encryptRbSession(rbSession) {
  const enc = new TextEncoder().encode(rbSession);
  // PKCS7 padding
  const pad = 16 - (enc.length % 16);
  const padded = new Uint8Array(enc.length + pad);
  padded.set(enc);
  padded.fill(pad, enc.length);
  const keyBytes = new Uint8Array([
    0xa7, 0x98, 0x1c, 0xc9, 0xeb, 0x2f, 0x4d, 0x19,
    0xdc, 0xfe, 0xa5, 0x7b, 0x10, 0x1e, 0xcd, 0x89,
  ]);
  const iv = new Uint8Array([
    0x80, 0x17, 0xd3, 0xa8, 0xf1, 0x40, 0x0d, 0x2f,
    0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["encrypt"]);
  // SubtleCrypto AES-CBC auto-applies PKCS7 padding. We MUST NOT pad twice
  // → encrypt the raw plaintext (NOT the padded buffer).
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, enc);
  const ctArr = new Uint8Array(ctBuf);
  let bin = "";
  for (let i = 0; i < ctArr.length; i++) bin += String.fromCharCode(ctArr[i]);
  const b64 = btoa(bin);
  return encodeURIComponent(b64) + "a";
}

/**
 * Minimal hls.js-backed player with our own controls. Performs the FULL
 * Jack07 stream resolution client-side so the rb-session is bound to the
 * user's browser/edge IP (segments authenticated with that IP serve fine).
 *
 *   apiUrl (server-built): /api/stream/detail?streamId=…&matchId=… &…
 *
 * The flow:
 *   1. fetch(apiUrl) → grab `rb-session` header + protobuf body
 *   2. parse field (10,2,4) ROT47-encoded URL → slice(8) → m3u8 URL
 *   3. AES-CBC encrypt rb-session with the embedded key/iv → base64url + 'a'
 *   4. Insert /token-XXX/ after host → final tokenized URL
 *   5. Feed to hls.js
 */
function Jack07Player({ apiUrl, loading, error, channelName, onFatalError }) {
  const videoRef = useRef(null);
  const wrapRef = useRef(null);
  const hlsRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [fs, setFs] = useState(false);
  const [playerErr, setPlayerErr] = useState(null);
  const [bufferingMsg, setBufferingMsg] = useState(null);
  const [resolvedUrl, setResolvedUrl] = useState(null);

  // Resolve stream URL whenever apiUrl changes
  useEffect(() => {
    if (!apiUrl) return;
    let cancelled = false;
    setResolvedUrl(null);
    setPlayerErr(null);
    setBufferingMsg("Récupération du flux…");
    (async () => {
      try {
        const r = await fetch(apiUrl, { credentials: "omit" });
        const rbSession = r.headers.get("rb-session");
        if (!rbSession) throw new Error("rb-session manquante");
        const buf = await r.arrayBuffer();
        // Decode protobuf body to find ROT47-encoded URL (field 10.2.4)
        const m3u8Url = extractM3u8FromPb(new Uint8Array(buf));
        if (!m3u8Url) throw new Error("Flux introuvable dans la réponse");
        // Encrypt rb-session → AES-CBC token
        const token = await encryptRbSession(rbSession);
        const u = new URL(m3u8Url);
        const tokenedUrl = `${u.origin}/token-${token}${u.pathname}${u.search}`;
        if (!cancelled) {
          setResolvedUrl(tokenedUrl);
          setBufferingMsg("Connexion au flux…");
        }
      } catch (e) {
        if (!cancelled) {
          setPlayerErr(`Résolution échouée: ${e.message}`);
          setBufferingMsg(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [apiUrl]);

  // Attach hls.js when resolved URL changes
  useEffect(() => {
    if (!resolvedUrl || !videoRef.current) return;
    const video = videoRef.current;

    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch { /* noop */ }
      hlsRef.current = null;
    }

    const playPromise = () => video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = resolvedUrl;
      video.addEventListener("loadeddata", () => { setBufferingMsg(null); playPromise(); }, { once: true });
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 8,
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 3,
        fragLoadingTimeOut: 15000,
        fragLoadingMaxRetry: 3,
      });
      hlsRef.current = hls;
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(resolvedUrl));
      hls.on(Hls.Events.MANIFEST_PARSED, () => { setBufferingMsg(null); playPromise(); });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            setPlayerErr("Flux protégé — bascule vers le lecteur Jack07…");
            if (typeof onFatalError === "function") setTimeout(() => onFatalError(), 800);
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            try { hls.recoverMediaError(); } catch { setPlayerErr("Erreur média"); }
          } else {
            setPlayerErr("Erreur lecture");
            if (typeof onFatalError === "function") setTimeout(() => onFatalError(), 800);
          }
        }
      });
    } else {
      setPlayerErr("HLS non supporté par ce navigateur");
    }

    return () => {
      if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* noop */ } hlsRef.current = null; }
    };
  }, [resolvedUrl, onFatalError]);

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

  const toggleMute = () => {
    const v = videoRef.current; if (!v) return;
    v.muted = !v.muted; setMuted(v.muted);
  };

  const toggleFs = () => {
    const el = wrapRef.current; if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  };

  const reload = () => {
    const v = videoRef.current; if (!v || !resolvedUrl) return;
    if (hlsRef.current) hlsRef.current.startLoad();
    v.currentTime = v.duration || 0;
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
      {(loading || bufferingMsg) && !playerErr && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none">
          <Loader2 className="animate-spin text-amber-400" size={28} />
          <span className="ml-3 text-white/80 text-sm">{loading ? "Recherche des sources…" : bufferingMsg}</span>
        </div>
      )}
      {(error || playerErr) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-6 text-center">
          <AlertTriangle className="text-amber-400 mb-2" size={28} />
          <div className="text-white font-semibold text-sm">{error || playerErr}</div>
          <div className="text-white/50 text-[11px] mt-1">Essayez de basculer sur une autre source ci-dessous.</div>
        </div>
      )}
      {/* Channel tag */}
      {channelName && !loading && !error && (
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur text-white text-[11px] font-semibold border border-white/15">
          {channelName}
        </div>
      )}
      {/* Controls */}
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
  const [fs, setFs] = useState(false);

  useEffect(() => {
    const onFs = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

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
    const u = siteUrl.split("#")[0];
    ifr.src = u + (u.includes("?") ? "&" : "?") + "_t=" + Date.now();
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
      style={{ aspectRatio: "16 / 9" }}
      data-testid="jack07-iframe-wrap"
    >
      <iframe
        ref={iframeRef}
        src={siteUrl}
        title="Jack07 player"
        className="absolute inset-0 w-full h-full"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        referrerPolicy="no-referrer"
        data-testid="jack07-iframe"
      />
      <div className="absolute top-2 right-2 flex gap-1">
        <button
          onClick={onBackToNative}
          className="iframe-player-btn"
          title="Réessayer le lecteur natif"
          data-testid="jack07-try-native"
        >
          <RotateCcw size={14} />
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
