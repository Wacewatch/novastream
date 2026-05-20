import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

/**
 * Public opaque-token resolver for Sports. Token is a base64url-encoded
 * "source:id" pair. We decode it CLIENT-SIDE so the upstream source name
 * never appears in any public-facing URL/JSON response.
 *
 * Route: /embed/sports/t/:token  →  /embed/sports/:source/:id
 */
export default function SportsTokenRedirect() {
  const { token } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    try {
      const padded = (token || "").replace(/-/g, "+").replace(/_/g, "/");
      const pad = "=".repeat((4 - (padded.length % 4)) % 4);
      const raw = atob(padded + pad);
      const colon = raw.indexOf(":");
      if (colon <= 0) throw new Error("Invalid token");
      const source = raw.slice(0, colon).trim();
      const id = raw.slice(colon + 1).trim();
      if (!source || !id) throw new Error("Invalid token");
      const search = window.location.search || "";
      navigate(
        `/embed/sports/${encodeURIComponent(source)}/${encodeURIComponent(id)}${search}`,
        { replace: true }
      );
    } catch (_e) {
      navigate("/", { replace: true });
    }
  }, [token, navigate]);

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center">
      <Loader2 className="animate-spin text-[#10b981]" size={36} />
    </div>
  );
}
