import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error(
    "[supabase] Missing env vars REACT_APP_SUPABASE_URL or REACT_APP_SUPABASE_ANON_KEY"
  );
}

export const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "livewatch-auth",
  },
});

/* Helpers shared between hooks/UI */
export function getRoleType(profile) {
  if (!profile) return "guest";
  if (profile.role === "admin") return "admin";
  if (profile.role === "vip" || profile.is_vip === true) return "vip";
  return "member";
}

export function hasAdFreeExperience(profile) {
  const r = getRoleType(profile);
  return r === "admin" || r === "vip";
}

export function getRoleDisplayName(profile) {
  const r = getRoleType(profile);
  if (r === "admin") return "Administrateur";
  if (r === "vip") return "VIP Premium";
  if (r === "member") return "Membre";
  return "Invité";
}

export function getRoleColor(profile) {
  const r = getRoleType(profile);
  if (r === "admin") return "#ff2e63";
  if (r === "vip") return "#facc15";
  if (r === "member") return "#60a5fa";
  return "#9ca3af";
}
