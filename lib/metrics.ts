// lib/metrics.ts - Core Web Vitals monitoring utility

type MetricName = 'CLS' | 'FCP' | 'FID' | 'INP' | 'LCP' | 'TTFB';

interface Metric {
  name: MetricName;
  value: number;
  id: string;
  delta: number;
}

/**
 * Report Web Vitals metrics to analytics
 * Uses web-vitals library pattern for reporting Core Web Vitals
 */
export function reportWebVital(metric: Metric): void {
  // Log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Web Vital] ${metric.name}:`, {
      value: metric.value.toFixed(2),
      delta: metric.delta.toFixed(2),
      id: metric.id,
    });
  }

  // Send to Google Analytics 4 if available
  if (typeof window !== 'undefined' && (window as any).gtag) {
    const gtag = (window as any).gtag;
    
    gtag('event', metric.name, {
      value: Math.round(metric.value * 100) / 100,
      metric_delta: Math.round(metric.delta * 100) / 100,
      metric_id: metric.id,
    });
  }
}

/**
 * Get current page load metrics from Performance API
 */
export function getPageLoadMetrics(): {
  domContentLoaded: number;
  loadComplete: number;
  firstPaint: number;
  firstContentfulPaint: number;
  largestContentfulPaint: number;
  cumulativeLayoutShift: number;
  firstInputDelay: number;
} | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const navEntries = window.performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
  const paintEntries = window.performance.getEntriesByType('paint') as PerformancePaintTiming[];
  const lcpEntries = window.performance.getEntriesByType('largest-contentful-paint') as any[];
  const clsEntries = window.performance.getEntriesByType('layout-shift') as any[];
  const fidEntries = window.performance.getEntriesByType('first-input') as any[];

  const navigation = navEntries[0];
  const fp = paintEntries.find(e => e.name === 'first-paint');
  const fcp = paintEntries.find(e => e.name === 'first-contentful-paint');
  const lcp = lcpEntries[0];
  
  // Calculate CLS (Cumulative Layout Shift)
  let cls = 0;
  if (clsEntries.length > 0) {
    cls = clsEntries.reduce((sum, entry) => sum + (entry.hadRecentInput ? 0 : entry.value), 0);
  }

  // Get FID (First Input Delay) - only available for first interaction
  const fid = fidEntries[0] ? fidEntries[0].processingStart - fidEntries[0].startTime : 0;

  if (!navigation) {
    return null;
  }

  return {
    domContentLoaded: navigation.domContentLoadedEventEnd - navigation.fetchStart,
    loadComplete: navigation.loadEventEnd - navigation.fetchStart,
    firstPaint: fp?.startTime || 0,
    firstContentfulPaint: fcp?.startTime || 0,
    largestContentfulPaint: lcp?.startTime || 0,
    cumulativeLayoutShift: cls,
    firstInputDelay: fid,
  };
}

/**
 * Log performance metrics to console for debugging
 */
export function logPageMetrics(): void {
  if (process.env.NODE_ENV !== 'development') return;
  
  const metrics = getPageLoadMetrics();
  if (metrics) {
    console.group('📊 Page Performance Metrics');
    console.log('DOM Content Loaded:', `${metrics.domContentLoaded}ms`);
    console.log('Page Load Complete:', `${metrics.loadComplete}ms`);
    console.log('First Paint:', `${metrics.firstPaint}ms`);
    console.log('First Contentful Paint:', `${metrics.firstContentfulPaint}ms`);
    console.log('Largest Contentful Paint:', `${metrics.largestContentfulPaint}ms`);
    console.log('Cumulative Layout Shift:', metrics.cumulativeLayoutShift.toFixed(3));
    console.log('First Input Delay:', `${metrics.firstInputDelay}ms`);
    console.groupEnd();
  }
}

/**
 * Check if a metric passes Core Web Vitals thresholds
 * 
 * Thresholds (Good/Poor):
 * - LCP: < 2.5s / >= 4s
 * - FID: < 100ms / >= 300ms
 * - CLS: < 0.1 / >= 0.25
 * - FCP: < 1.8s / >= 3s
 * - INP: < 200ms / >= 500ms
 */
export function isMetricGood(name: string, value: number): boolean {
  const thresholds: Record<string, { good: number; poor: number }> = {
    LCP: { good: 2500, poor: 4000 },
    FID: { good: 100, poor: 300 },
    CLS: { good: 0.1, poor: 0.25 },
    FCP: { good: 1800, poor: 3000 },
    INP: { good: 200, poor: 500 },
    TTFB: { good: 800, poor: 1800 },
  };

  const threshold = thresholds[name];
  if (!threshold) return true;

  return value < threshold.good;
}

/**
 * Get performance rating based on Core Web Vitals
 */
export function getPerformanceRating(): 'good' | 'needs-improvement' | 'poor' {
  const metrics = getPageLoadMetrics();
  if (!metrics) return 'needs-improvement';

  let score = 0;
  const checks = [
    { name: 'LCP', value: metrics.largestContentfulPaint, good: 2500, weight: 3 },
    { name: 'CLS', value: metrics.cumulativeLayoutShift * 1000, good: 100, weight: 2 }, // Convert to ms
    { name: 'FID', value: metrics.firstInputDelay, good: 100, weight: 2 },
    { name: 'FCP', value: metrics.firstContentfulPaint, good: 1800, weight: 1 },
  ];

  for (const check of checks) {
    if (check.value <= check.good) {
      score += check.weight;
    } else if (check.value <= check.good * 1.5) {
      // Between good and poor threshold
      score += check.weight * 0.5;
    }
  }

  const maxScore = checks.reduce((sum, c) => sum + c.weight, 0);
  const percentage = (score / maxScore) * 100;

  if (percentage >= 75) return 'good';
  if (percentage >= 50) return 'needs-improvement';
  return 'poor';
}