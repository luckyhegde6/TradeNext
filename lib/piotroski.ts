// lib/piotroski.ts
export function piotroskiScore(f: Record<string, unknown>): number {
    let s = 0;
    if (!f) return 0;
    if (f.netIncome && Number(f.netIncome) > 0) s++;
    if (f.roe && Number(f.roe) > 0) s++;
    if (f.operatingCashFlow && Number(f.operatingCashFlow) > 0) s++;
    if (f.debtEquity !== undefined && Number(f.debtEquity) < 1) s++;
    if (f.currentRatio !== undefined && Number(f.currentRatio) > 1) s++;
    if (f.grossMargin && Number(f.grossMargin) > 0) s++;
    if (f.assetTurnover && Number(f.assetTurnover) > 0) s++;
    if (f.revenueGrowth && Number(f.revenueGrowth) > 0) s++;
    if (f.epsGrowth && Number(f.epsGrowth) > 0) s++;
    return Math.min(Math.max(s, 0), 9);
}
