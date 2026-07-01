import { useCallback, useEffect, useState } from "react";
import {
  getRuntimeDefaults,
  getPermissionRules,
  listRuntimeProfiles,
  type RuntimeDefaults,
  type PermissionRules,
  type RuntimeProfile,
} from "../lib/settings";
import {
  getAnalyticsConsent,
  type AnalyticsConsent,
} from "../lib/analytics";

export type SettingsState = {
  profiles: RuntimeProfile[];
  defaults: RuntimeDefaults | null;
  permissions: PermissionRules | null;
  analyticsConsent: AnalyticsConsent | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

export function useSettings(): SettingsState {
  const [profiles, setProfiles] = useState<RuntimeProfile[]>([]);
  const [defaults, setDefaults] = useState<RuntimeDefaults | null>(null);
  const [permissions, setPermissions] = useState<PermissionRules | null>(null);
  const [analyticsConsent, setAnalyticsConsent] = useState<AnalyticsConsent | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [p, d, perm, consent] = await Promise.all([
        listRuntimeProfiles(),
        getRuntimeDefaults(),
        getPermissionRules(),
        getAnalyticsConsent(),
      ]);
      setProfiles(p);
      setDefaults(d);
      setPermissions(perm);
      setAnalyticsConsent(consent);
    } catch {
      // ignore — settings load is non-blocking
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { profiles, defaults, permissions, analyticsConsent, loading, refresh };
}
