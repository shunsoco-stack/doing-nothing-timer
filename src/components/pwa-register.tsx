"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !window.isSecureContext ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    // Updates follow the browser lifecycle. Never reload a running timer.
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // Private browsing, storage limits, or offline registration must not
        // prevent the timer and its in-memory fallback from working.
      });
  }, []);

  return null;
}
