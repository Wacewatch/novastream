import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

/**
 * Public opaque-token resolver for BossTV. Token is base64url-encoded
 * "matchId:serverIdx". Route: /embed/bosstv/t/:token →
 * /embed/bosstv/:matchId/:serverIdx
 */
export default function BossTvTokenRedirect() {
  const { token } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    try {
      const padded = (token || "").replace(/-/g, "+").replace(/_/g, "/");
      const pad = "=".repeat((4 - (padded.length % 4)) % 4);
      const raw = atob(padded + pad);
      const colon = raw.indexOf(":");
      if (colon <= 0) throw new Error("Invalid token");
      const matchId = raw.slice(0, colon).trim();
      const idx = raw.slice(colon + 1).trim();
      if (!matchId) throw new Error("Invalid token");
      navigate(
        `/embed/bosstv/${encodeURIComponent(matchId)}/${encodeURIComponent(idx || "0")}`,
        { replace: true }
      );
    } catch (_e) {
      navigate("/", { replace: true });
    }
  }, [token, navigate]);

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center">
      <Loader2 className="animate-spin text-[#ff2e63]" size={36} />
    </div>
  );
}
