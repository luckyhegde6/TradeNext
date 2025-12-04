// app/api/piotroski/[ticker]/route.ts
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: tickerParam } = await params;
  const ticker = tickerParam.toUpperCase();

  // Lazy-load Prisma to avoid build-time initialization
  const { default: prisma } = await import("@/lib/prisma");

  try {
    // latest snapshot
    const latest = await prisma.fundamental.findFirst({
      where: { ticker },
      orderBy: { asOf: 'desc' }
    });
    if (!latest) return NextResponse.json({ error: 'no fundamentals' }, { status: 404 });

    // prior year (closest earlier snapshot, prefer same period_type and asOf ~ 1 year earlier)
    const prior = await prisma.fundamental.findFirst({
      where: { ticker, asOf: { lt: latest.asOf } },
      orderBy: { asOf: 'desc' }
    });

    // helper to safely read numeric values
    const val = (x: unknown) => (x === null || x === undefined) ? null : Number(x);

    // 9 checks (Piotroski F-score):
    const checks: { key: string, ok: boolean, explain: string }[] = [];

    // 1. Positive Net Income
    checks.push({
      key: "positive_net_income",
      ok: (val(latest.netIncome) ?? 0) > 0,
      explain: `Net income ${val(latest.netIncome)} > 0`
    });

    // 2. Positive Operating Cash Flow
    // Note: operatingCashFlow field doesn't exist in schema, defaulting to false
    const ocf = (latest as Record<string, unknown>).operatingCashFlow;
    checks.push({
      key: "positive_ocf",
      ok: (val(ocf) ?? 0) > 0,
      explain: `Operating cash flow ${val(ocf)}`
    });

    // 3. ROA improvement (or positive)
    const latestNI = val(latest.netIncome);
    const latestTA = val(latest.totalAssets);
    const roa = latestNI && latestTA ? latestNI / latestTA : null;
    const priorNI = prior ? val(prior.netIncome) : null;
    const priorTA = prior ? val(prior.totalAssets) : null;
    const priorRoa = priorNI && priorTA ? priorNI / priorTA : null;
    checks.push({
      key: "roa_improved",
      ok: priorRoa === null ? (roa !== null && roa > 0) : (roa !== null && roa > priorRoa),
      explain: `ROA now ${roa} prior ${priorRoa}`
    });

    // 4. Cash flow > Net income (quality of earnings)
    const ocfVal = val(ocf);
    const niVal = val(latest.netIncome);
    checks.push({
      key: "cf_vs_ni",
      ok: (ocfVal ?? 0) > (niVal ?? 0),
      explain: `OCF ${ocfVal} vs NI ${niVal}`
    });

    // 5. Leverage/long-term debt reduction or no increase
    // We'll use total_liabilities as proxy (or if you have long_term_debt use that)
    const priorTL = prior ? val(prior.totalLiabilities) : null;
    const latestTL = val(latest.totalLiabilities);
    checks.push({
      key: "leverage_decrease",
      ok: priorTL === null ? true : ((latestTL ?? 0) <= priorTL),
      explain: `Total liabilities now ${latestTL} prior ${priorTL}`
    });

    // 6. Current ratio improvement (if you have current assets/current liabilities; use proxy if not)
    // Assuming you have currentRatio field, else skip and default to true
    const curRatio = (latest as Record<string, unknown>).currentRatio ? val((latest as Record<string, unknown>).currentRatio) : null;
    const priorCur = prior && (prior as Record<string, unknown>).currentRatio ? val((prior as Record<string, unknown>).currentRatio) : null;
    checks.push({
      key: "current_ratio",
      ok: curRatio === null ? true : (priorCur === null ? curRatio > 1 : curRatio > priorCur),
      explain: `Current ratio now ${curRatio} prior ${priorCur}`
    });

    // 7. No new shares (share dilution) — check shareholdersEquity growth vs netIncome (proxy)
    // If share issuance data not available, check equity growth not large increase
    const priorEquity = prior ? val(prior.shareholdersEquity) : null;
    const latestEquity = val(latest.shareholdersEquity);
    checks.push({
      key: "no_new_shares",
      ok: priorEquity === null ? true : ((latestEquity ?? 0) <= priorEquity * 1.05),
      explain: `Shareholders equity now ${latestEquity} prior ${priorEquity}`
    });

    // 8. Gross margin improvement
    const gm = (latest as Record<string, unknown>).grossMargin ? val((latest as Record<string, unknown>).grossMargin) : null;
    const priorGm = prior && (prior as Record<string, unknown>).grossMargin ? val((prior as Record<string, unknown>).grossMargin) : null;
    checks.push({
      key: "gross_margin",
      ok: gm === null ? true : (priorGm === null ? gm > 0 : gm > priorGm),
      explain: `Gross margin now ${gm} prior ${priorGm}`
    });

    // 9. Asset turnover improvement (revenue / assets)
    const latestRev = val(latest.revenue);
    const latestAssets = val(latest.totalAssets);
    const at = latestRev && latestAssets ? latestRev / latestAssets : null;
    const priorRev = prior ? val(prior.revenue) : null;
    const priorAssets = prior ? val(prior.totalAssets) : null;
    const priorAt = priorRev && priorAssets ? priorRev / priorAssets : null;
    checks.push({
      key: "asset_turnover",
      ok: priorAt === null ? (at !== null && at > 0) : (at !== null && at > priorAt),
      explain: `Asset turnover now ${at} prior ${priorAt}`
    });

    const score = checks.reduce((s, c) => s + (c.ok ? 1 : 0), 0);

    return NextResponse.json({ ticker, score, checks, asOf: latest.asOf });
  } catch (err: unknown) {
    console.error('piotroski error', err);
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  } finally {
    // don't call prisma.$disconnect() in serverless repeated calls; leave to process lifecycle
  }
}
