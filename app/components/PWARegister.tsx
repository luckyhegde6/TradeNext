// app/components/PWARegister.tsx — PWA service-worker registration.
"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js at runtime via the browser's ServiceWorker API.
 *
 * Why a dedicated component:
 *   - Keeps SW concerns out of server components (no window during SSR).
 *   - Registers only in the browser, only on HTTPS/localhost (secure context),
 *     and only after load so it never competes with first-paint resources.
 *   - Failure is non-fatal (logged, never throws) — PWA is progressive
 *     enhancement, not a hard dependency.
 */
export default function PWARegister() {
  useEffect(() => {
    // Guard: browser only (window exists), SW supported, secure context.
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    if (window.location.protocol !== "https:" && !isLocalhost) return;

    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          // Ready for use; optional: check registration.active here.
          console.log("[PWA] Service worker registered", registration.scope);
        })
        .catch((err) => {
          // Non-fatal — log and continue (site works without SW).
          console.warn("[PWA] Service worker registration failed", err);
        });
    });
  }, []);

  return null;
}
