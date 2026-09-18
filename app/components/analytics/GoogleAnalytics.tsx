// app/components/analytics/GoogleAnalytics.tsx
"use client";

import { useEffect } from "react";

/**
 * Google Analytics 4 Integration
 * 
 * Security Considerations:
 * - Only renders if NEXT_PUBLIC_GA_ID is set (won't break if not configured)
 * - GA ID is public by design (not a secret)
 * - No user data is tracked unless explicitly configured
 * - Validates GA ID format before loading script
 * - Uses exact gtag.js implementation for compatibility
 */
export function Analytics() {
  const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_ID;
  const gaIdPattern = /^G-[A-Z0-9]{8,12}$/;
  const enabled =
    typeof GA_MEASUREMENT_ID === "string" &&
    GA_MEASUREMENT_ID !== "" &&
    gaIdPattern.test(GA_MEASUREMENT_ID);

  // Inject gtag.js script — hook is called unconditionally (early returns
  // after hooks would violate react-hooks/rules-of-hooks); gate inside.
  useEffect(() => {
    if (!enabled || !GA_MEASUREMENT_ID) {
      return;
    }
    // Add gtag script
    const gtagScript = document.createElement("script");
    gtagScript.async = true;
    gtagScript.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
    document.head.appendChild(gtagScript);
    
    // Initialize dataLayer and gtag function
    const inlineScript = document.createElement("script");
    inlineScript.innerHTML = `
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${GA_MEASUREMENT_ID}');
    `;
    document.head.appendChild(inlineScript);
    
    return () => {
      // Cleanup on unmount
      if (document.head.contains(gtagScript)) {
        document.head.removeChild(gtagScript);
      }
      if (document.head.contains(inlineScript)) {
        document.head.removeChild(inlineScript);
      }
    };
  }, [enabled, GA_MEASUREMENT_ID]);

  if (!enabled) {
    if (GA_MEASUREMENT_ID) {
      console.warn(
        "[Analytics] Invalid GA_MEASUREMENT_ID format. Expected G-XXXXXXXXXX"
      );
    }
    return null;
  }

  return null;
}

export default Analytics;
