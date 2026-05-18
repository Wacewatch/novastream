import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

// Silence opaque cross-origin "Script error." entries from third-party
// resources (ad popups, hls.js internals on some hosts). These have no
// useful message/stack and otherwise crash the React error overlay.
if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => {
    const msg = (e && e.message) || "";
    if (msg === "Script error." || msg === "" || !e.filename) {
      e.stopImmediatePropagation();
      e.preventDefault();
      return false;
    }
    return undefined;
  });
  window.addEventListener("unhandledrejection", (e) => {
    // Silence aborted fetches from React StrictMode double-effect and similar
    const r = e && e.reason;
    const name = r && (r.name || "");
    const msg = (r && (r.message || String(r))) || "";
    if (name === "AbortError" || /aborted|CanceledError/i.test(msg)) {
      e.preventDefault();
    }
  });
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
