// app/components/analytics/WebVitals.tsx
"use client";

import { useEffect } from "react";

/**
 * Core Web Vitals tracking component
 * Uses Performance Observer API to measure:
 * - LCP (Largest Contentful Paint)
 * - FID (First Input Delay)
 * - CLS (Cumulative Layout Shift)
 * - FCP (First Contentful Paint)
 * - TTFB (Time to First Byte)
 */
export default function WebVitals() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const sendToApi = async (metric: {
      name: string;
      value: number;
      delta: number;
      id: string;
      rating: string;
    }) => {
      try {
        await fetch("/api/metrics/web-vitals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...metric,
            url: window.location.href,
            timestamp: new Date().toISOString(),
          }),
          keepalive: true,
        });
      } catch {
        // Silent fail
      }
    };

    const sendToGA = (metric: { name: string; value: number; delta: number; id: string }) => {
      if (typeof window !== "undefined" && (window as any).gtag) {
        const gtag = (window as any).gtag;
        gtag("event", metric.name, {
          value: Math.round(metric.value * 100) / 100,
          metric_delta: Math.round(metric.delta * 100) / 100,
          metric_id: metric.id,
          page_path: window.location.pathname,
        });
      }
    };

    const logToConsole = (metric: { name: string; value: number; rating: string }) => {
      if (process.env.NODE_ENV === "development") {
        const ratingStr = metric.rating === "good" ? "GOOD" : metric.rating === "needs-improvement" ? "NEEDS IMPROVEMENT" : "POOR";
        console.log(`[Web Vital] ${metric.name}: ${metric.value.toFixed(2)}ms (${ratingStr})`);
      }
    };

    const handleMetric = (metric: { name: string; value: number; delta: number; id: string; rating: string }) => {
      sendToApi(metric);
      sendToGA(metric);
      logToConsole(metric);
    };

    const checkAndReport = () => {
      if (typeof PerformanceObserver === "undefined") return;

      // LCP
      try {
        const lcpObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const lastEntry = entries[entries.length - 1] as any;
          if (lastEntry) {
            const val = lastEntry.startTime;
            const rating = val < 2500 ? "good" : val < 4000 ? "needs-improvement" : "poor";
            handleMetric({ name: "LCP", value: val, delta: val, id: `lcp-${Date.now()}`, rating });
          }
        });
        lcpObserver.observe({ entryTypes: ["largest-contentful-paint"] });
      } catch { /* ignore */ }

      // CLS
      try {
        let clsValue = 0;
        const clsObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as any) {
            if (!entry.hadRecentInput) clsValue += entry.value;
          }
          const rating = clsValue < 0.1 ? "good" : clsValue < 0.25 ? "needs-improvement" : "poor";
          handleMetric({ name: "CLS", value: clsValue, delta: clsValue, id: `cls-${Date.now()}`, rating });
        });
        clsObserver.observe({ entryTypes: ["layout-shift"] });
      } catch { /* ignore */ }

      // FID
      try {
        const fidObserver = new PerformanceObserver((list) => {
          const entry = list.getEntries()[0] as any;
          if (entry) {
            const val = entry.processingStart - entry.startTime;
            const rating = val < 100 ? "good" : val < 300 ? "needs-improvement" : "poor";
            handleMetric({ name: "FID", value: val, delta: val, id: `fid-${Date.now()}`, rating });
          }
        });
        fidObserver.observe({ entryTypes: ["first-input"] });
      } catch { /* ignore */ }

      // FCP
      try {
        const fcpObserver = new PerformanceObserver((list) => {
          const fcp = list.getEntries().find((e: any) => e.name === "first-contentful-paint");
          if (fcp) {
            const val = fcp.startTime;
            const rating = val < 1800 ? "good" : val < 3000 ? "needs-improvement" : "poor";
            handleMetric({ name: "FCP", value: val, delta: val, id: `fcp-${Date.now()}`, rating });
          }
        });
        fcpObserver.observe({ entryTypes: ["paint"] });
      } catch { /* ignore */ }

      // TTFB
      const nav = performance.getEntriesByType("navigation")[0] as any;
      if (nav) {
        const val = nav.responseStart;
        const rating = val < 800 ? "good" : val < 1800 ? "needs-improvement" : "poor";
        handleMetric({ name: "TTFB", value: val, delta: val, id: `ttfb-${Date.now()}`, rating });
      }
    };

    if (document.readyState === "complete") {
      checkAndReport();
    } else {
      window.addEventListener("load", checkAndReport);
    }
  }, []);

  return null;
}