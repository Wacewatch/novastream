import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

/**
 * Public opaque-token resolver for JackTV. Token is a base64url-encoded
 * match id. We decode CLIENT-SIDE because the Kubernetes ingress routes
 * everything non-/api/* to the frontend (so a FastAPI redirect route
 * cannot be reached from the public preview URL).
 *
 * Route: /embed/jacktv/t/:token  →  /embed/jacktv/:matchId
 */
export default function JackTvTokenRedirect() {
  const { token } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    try {
      const padded = (token || "").replace(/-/g, "+").replace(/_/g, "/");
      const pad = "=".repeat((4 - (padded.length % 4)) % 4);
      const matchId = atob(padded + pad).trim();
      if (!matchId) throw new Error("Invalid token");
      const search = window.location.search || "";
      navigate(`/embed/jacktv/${encodeURIComponent(matchId)}${search}`, { replace: true });
    } catch (_e) {
      navigate("/", { replace: true });
    }
  }, [token, navigate]);

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center" data-testid="jacktv-token-redirect">
      <Loader2 className="animate-spin text-amber-400" size={36} />
    </div>
  );
}
