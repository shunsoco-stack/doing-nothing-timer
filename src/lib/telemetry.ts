import { track } from "@vercel/analytics";

export type TrackedEvent = "session_start" | "session_end" | "achievement_unlock" | "result_share";

export function analyticsAllowed(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.doNotTrack !== "1" && !(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl;
}

/** No IDs, timestamps, input values or record history leave the device. */
export function trackEvent(name: TrackedEvent, properties: Record<string, string | number>): void {
  if (!analyticsAllowed()) return;
  try {
    track(name, properties);
  } catch {
    // Analytics is optional: a blocked script or offline device must never stop a timer.
  }
}
