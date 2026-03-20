// app/components/analytics/trackEvent.ts
/**
 * Custom Event Tracking for Google Analytics
 * 
 * Security Considerations:
 * - No PII (Personally Identifiable Information) should be passed
 * - Event names and labels are sanitized
 * - Values are validated as numbers
 */

// Extend Window interface for GA4
// Note: Using type-safe declarations compatible with @next/third-parties
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Track a custom event in Google Analytics
 */
export function trackEvent(
  action: string,
  category: string,
  options?: {
    label?: string;
    value?: number;
    currency?: string;
  }
): void {
  if (typeof window === "undefined" || !window.gtag) {
    return;
  }

  // Sanitize inputs to prevent XSS
  const sanitizedAction = sanitizeString(action, 50);
  const sanitizedCategory = sanitizeString(category, 50);
  const sanitizedLabel = options?.label ? sanitizeString(options.label, 100) : undefined;
  
  // Validate value is a positive integer
  const validatedValue = options?.value && options.value >= 0 ? Math.floor(options.value) : undefined;

  window.gtag("event", sanitizedAction, {
    event_category: sanitizedCategory,
    event_label: sanitizedLabel,
    value: validatedValue,
    currency: options?.currency,
  });
}

/**
 * Track page views
 */
export function trackPageView(url: string, title?: string): void {
  if (typeof window === "undefined" || !window.gtag) {
    return;
  }

  // Validate URL
  const sanitizedUrl = sanitizeString(url, 200);
  const sanitizedTitle = title ? sanitizeString(title, 100) : undefined;

  window.gtag("event", "page_view", {
    page_location: sanitizedUrl,
    page_title: sanitizedTitle,
  });
}

/**
 * Track user timing (performance metrics)
 */
export function trackTiming(
  category: string,
  variable: string,
  value: number,
  label?: string
): void {
  if (typeof window === "undefined" || !window.gtag) {
    return;
  }

  window.gtag("event", "timing_complete", {
    event_category: sanitizeString(category, 50),
    event_var: sanitizeString(variable, 50),
    value: Math.floor(value),
    event_label: label ? sanitizeString(label, 100) : undefined,
  });
}

/**
 * Track stock-related events
 */
export const StockTracking = {
  viewStock: (symbol: string, companyName?: string) => {
    trackEvent("view_stock", "engagement", {
      label: symbol,
      value: 1,
    });
  },

  createAlert: (symbol: string, alertType: string) => {
    trackEvent("create_alert", "engagement", {
      label: `${symbol} - ${alertType}`,
      value: 1,
    });
  },

  triggerAlert: (symbol: string, alertType: string) => {
    trackEvent("alert_triggered", "engagement", {
      label: `${symbol} - ${alertType}`,
      value: 1,
    });
  },

  useScreener: (filters: Record<string, unknown>) => {
    const filterCount = Object.keys(filters).length;
    trackEvent("use_screener", "engagement", {
      label: "stock_screener",
      value: filterCount,
    });
  },

  addToWatchlist: (symbol: string) => {
    trackEvent("add_watchlist", "engagement", {
      label: symbol,
      value: 1,
    });
  },

  portfolioAction: (action: "view" | "add" | "edit" | "delete") => {
    trackEvent(`portfolio_${action}`, "portfolio");
  },
};

/**
 * Track admin-related events (optional, for analytics)
 */
export const AdminTracking = {
  syncData: (dataType: string, recordCount?: number) => {
    trackEvent("admin_sync", "admin", {
      label: dataType,
      value: recordCount,
    });
  },

  manageUser: (action: string) => {
    trackEvent(`admin_user_${action}`, "admin");
  },

  triggerTask: (taskType: string) => {
    trackEvent("admin_task_trigger", "admin", {
      label: taskType,
      value: 1,
    });
  },
};

/**
 * Sanitize string input to prevent XSS
 * - Removes HTML tags
 * - Limits length
 * - Only allows safe characters
 */
function sanitizeString(input: string, maxLength: number): string {
  return input
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/[<>\"\'&]/g, "") // Remove potentially dangerous characters
    .trim()
    .slice(0, maxLength);
}

export default {
  trackEvent,
  trackPageView,
  trackTiming,
  StockTracking,
  AdminTracking,
};
