// lib/utils/date-utils.ts

/**
 * Parse various date formats from NSE API and return a Date object
 * Supports:
 * - DD-MMM-YYYY (e.g., "01-APR-2026")
 * - ISO 8601 (e.g., "2026-04-01T18:30:00.000Z")
 * - ISO date only (e.g., "2026-04-01")
 */
export function parseNseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  
  // Try ISO format first (most common from NSE)
  const isoDate = new Date(dateStr);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }
  
  // Try DD-MMM-YYYY format
  try {
    const [day, month, year] = dateStr.split("-");
    if (day && month && year) {
      const monthIndex = new Date(`${month} 1, 2000`).getMonth();
      const date = new Date(parseInt(year), monthIndex, parseInt(day));
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
  } catch {
    // fall through
  }
  
  return null;
}

/**
 * Format a date as DD-MMM-YYYY with day of week
 * Example: "01-APR-2026 (Thursday)"
 */
export function formatDateWithDay(dateStr: string): string {
  const date = parseNseDate(dateStr);
  if (!date) return dateStr || "-";
  
  const day = date.getDate().toString().padStart(2, '0');
  const month = date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  const year = date.getFullYear();
  const dayOfWeek = date.toLocaleDateString('en-IN', { weekday: 'long' });
  
  return `${day}-${month}-${year} (${dayOfWeek})`;
}

/**
 * Format date as DD-MMM-YYYY
 * Example: "01-APR-2026"
 */
export function formatDateCompact(dateStr: string): string {
  const date = parseNseDate(dateStr);
  if (!date) return dateStr || "-";
  
  const day = date.getDate().toString().padStart(2, '0');
  const month = date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  const year = date.getFullYear();
  
  return `${day}-${month}-${year}`;
}

/**
 * Calculate days remaining until ex-date
 * Returns negative if date has passed
 */
export function getDaysRemaining(dateStr: string): number {
  const date = parseNseDate(dateStr);
  if (!date) return Infinity;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);
  
  return Math.ceil((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Get urgency class based on days remaining
 */
export function getUrgencyClass(dateStr: string): string {
  const days = getDaysRemaining(dateStr);
  
  if (days >= 0 && days <= 2) return "bg-red-50 dark:bg-red-900/10 border-l-4 border-red-500";
  if (days > 2 && days <= 7) return "bg-yellow-50 dark:bg-yellow-900/10 border-l-4 border-yellow-500";
  if (days > 7 && days <= 30) return "bg-blue-50 dark:bg-blue-900/10 border-l-4 border-blue-500";
  return "";
}
