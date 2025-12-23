import { MARKET_TIMINGS, MARKET_HOLIDAYS } from "@/lib/constants";

/**
 * Checks if the Indian market is currently open based on IST time.
 */
export function isMarketOpen(): boolean {
    const now = new Date();
    const istDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

    const day = istDate.getDay();
    // 0 = Sunday, 6 = Saturday
    if (day === 0 || day === 6) return false;

    const dateStr = istDate.toISOString().split("T")[0];
    if (MARKET_HOLIDAYS.includes(dateStr)) return false;

    const hours = istDate.getHours();
    const minutes = istDate.getMinutes();
    const currentTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

    return currentTime >= MARKET_TIMINGS.start && currentTime <= MARKET_TIMINGS.end;
}

/**
 * Calculates the time in milliseconds until the next market opening (9:15 AM IST).
 */
export function getMillisecondsUntilNextMarketOpen(): number {
    const now = new Date();
    const istDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

    let targetDate = new Date(istDate);
    const [startHour, startMinute] = MARKET_TIMINGS.start.split(':').map(Number);

    targetDate.setHours(startHour, startMinute, 0, 0);

    // If already past today's opening, move to tomorrow
    if (istDate >= targetDate) {
        targetDate.setDate(targetDate.getDate() + 1);
    }

    // Skip weekends
    while (targetDate.getDay() === 0 || targetDate.getDay() === 6 || MARKET_HOLIDAYS.includes(targetDate.toISOString().split("T")[0])) {
        targetDate.setDate(targetDate.getDate() + 1);
    }

    // Convert target IST back to UTC-relative timestamp for the current runtime
    // The simplest way is to get the difference in the local system time
    const diff = targetDate.getTime() - istDate.getTime();
    return diff;
}

/**
 * Returns a recommended TTL in milliseconds based on market status.
 * If market is open, returns the provided defaultTtl.
 * If market is closed, returns time until next market open.
 */
export function getRecommendedTTL(defaultTtlMs: number): number {
    if (isMarketOpen()) {
        return defaultTtlMs;
    }
    return getMillisecondsUntilNextMarketOpen();
}
