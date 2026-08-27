"use client";

import { Analytics } from "@vercel/analytics/next";
import { analyticsAllowed } from "@/lib/telemetry";

export function PrivacyAnalytics() {
  return (
    <Analytics
      beforeSend={(event) => {
        if (!analyticsAllowed()) return null;
        const url = new URL(event.url);
        return { ...event, url: `${url.origin}${url.pathname}` };
      }}
    />
  );
}
