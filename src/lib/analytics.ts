import { invoke } from "@tauri-apps/api/core";

export type AnalyticsConsent = {
  collectionEnabled: boolean;
  uploadEnabled: boolean;
  consentVersion: string | null;
  consentedAt: number | null;
};

export type AnalyticsEvent = {
  id: string;
  eventName: string;
  featureArea: string;
  outcome: string | null;
  durationMs: number | null;
  adapterId: string | null;
  errorClass: string | null;
  createdAt: number;
};

export async function getAnalyticsConsent(): Promise<AnalyticsConsent> {
  return invoke<AnalyticsConsent>("get_analytics_consent");
}

export async function setAnalyticsConsent(consent: AnalyticsConsent): Promise<void> {
  return invoke("set_analytics_consent", { consent });
}

export async function listAnalyticsEvents(limit?: number): Promise<AnalyticsEvent[]> {
  return invoke<AnalyticsEvent[]>("list_analytics_events", { limit: limit ?? 100 });
}

export async function analyticsEventCount(): Promise<number> {
  return invoke<number>("analytics_event_count");
}

export async function deleteAnalyticsEvents(): Promise<void> {
  return invoke("delete_analytics_events");
}

export async function exportAnalyticsJson(): Promise<string> {
  return invoke<string>("export_analytics_json");
}

export async function recordAnalyticsEvent(
  eventName: string,
  featureArea: string,
  outcome?: string,
  durationMs?: number,
  adapterId?: string,
  errorClass?: string,
): Promise<void> {
  return invoke("record_analytics_event", {
    eventName,
    featureArea,
    outcome: outcome ?? null,
    durationMs: durationMs ?? null,
    adapterId: adapterId ?? null,
    errorClass: errorClass ?? null,
  });
}
