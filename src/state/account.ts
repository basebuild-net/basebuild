import { useCallback, useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  authStatus,
  authFetchProfile,
  authSignOut,
  type NativeProfile,
  type StoredAuth,
} from "../lib/auth";

export type AccountState = {
  auth: StoredAuth | null;
  profile: NativeProfile | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

export function useAccount(): AccountState {
  const [auth, setAuth] = useState<StoredAuth | null>(null);
  const [profile, setProfile] = useState<NativeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const stored = await authStatus();
      setAuth(stored);
      if (stored?.user) {
        setProfile(stored.user);
      } else if (stored?.accessToken) {
        try {
          const p = await authFetchProfile();
          setProfile(p);
        } catch {
          setProfile(null);
        }
      } else {
        setProfile(null);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await authSignOut();
      setAuth(null);
      setProfile(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Listen for auth-changed events from the backend (e.g. device flow completion)
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    listen("auth://changed", () => { void refresh(); }).then((fn) => { unlisten = fn; }).catch(() => {});
    return () => { unlisten?.(); };
  }, [refresh]);

  return { auth, profile, loading, error, refresh, signOut };
}
