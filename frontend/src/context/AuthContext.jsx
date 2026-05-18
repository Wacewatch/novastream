import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  supabase,
  getRoleType,
  hasAdFreeExperience,
  getRoleDisplayName,
  getRoleColor,
} from "@/lib/supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null);
      return null;
    }
    try {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("id, email, role, is_vip, vip_granted_at, created_at")
        .eq("id", userId)
        .single();
      if (error) {
        if (error.code !== "PGRST116") {
          // eslint-disable-next-line no-console
          console.warn("[auth] profile fetch error", error.message);
        }
        setProfile(null);
        return null;
      }
      setProfile(data);
      return data;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[auth] profile fetch exception", e);
      setProfile(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      setUser(session?.user || null);
      await fetchProfile(session?.user?.id);
      setLoading(false);
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user || null);
      await fetchProfile(session?.user?.id);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw new Error(error.message);
    return data;
  }, []);

  const signUp = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) throw new Error(error.message);
    return data;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user?.id) return;
    await fetchProfile(user.id);
  }, [user, fetchProfile]);

  const role = getRoleType(profile);

  const value = useMemo(
    () => ({
      user,
      profile,
      loading,
      role,
      isAdmin: role === "admin",
      isVip: role === "vip" || role === "admin",
      hasAdFreeExperience: hasAdFreeExperience(profile),
      roleLabel: getRoleDisplayName(profile),
      roleColor: getRoleColor(profile),
      signIn,
      signUp,
      signOut,
      refreshProfile,
    }),
    [user, profile, loading, role, signIn, signUp, signOut, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
