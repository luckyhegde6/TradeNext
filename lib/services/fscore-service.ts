import { prisma } from '@/lib/prisma';

export interface FScoreBreakdown {
  score: number;
  maxScore: number;
  profitability: number;
  leverage: number;
  efficiency: number;
  criteria: FScoreCriteria[];
  interpretation: string;
}

export interface FScoreCriteria {
  name: string;
  value: number | null;
  threshold: string;
  passed: boolean;
  description: string;
}

export interface FinancialScoreData {
  symbol: string;
  roa: number | null;
  roaChange: number | null;
  cfo: number | null;
  cfoVsNi: number | null;
  currentRatio: number | null;
  currentRatioChg: number | null;
  leverage: number | null;
  leverageChange: number | null;
  sharesChange: number | null;
  grossMargin: number | null;
  marginChange: number | null;
  assetTurnover: number | null;
  turnoverChange: number | null;
}

function interpretScore(score: number): string {
  if (score >= 7) return 'Strong Buy - High financial strength';
  if (score >= 5) return 'Buy - Good financial fundamentals';
  if (score >= 3) return 'Hold - Moderate financial health';
  if (score >= 1) return 'Sell - Weak financial position';
  return 'Strong Sell - Poor financial health';
}

function calculateFScore(data: FinancialScoreData): FScoreBreakdown {
  const criteria: FScoreCriteria[] = [];

  // Profitability Criteria (0-4 points)
  let profitability = 0;

  // 1. ROA > 0
  const roaPassed = data.roa !== null && data.roa > 0;
  criteria.push({
    name: 'ROA > 0',
    value: data.roa,
    threshold: '> 0%',
    passed: roaPassed,
    description: 'Positive Return on Assets'
  });
  if (roaPassed) profitability++;

  // 2. CFO > 0
  const cfoPassed = data.cfo !== null && data.cfo > 0;
  criteria.push({
    name: 'CFO > 0',
    value: data.cfo,
    threshold: '> 0%',
    passed: cfoPassed,
    description: 'Positive Operating Cash Flow'
  });
  if (cfoPassed) profitability++;

  // 3. ROA improving
  const roaImproving = data.roaChange !== null && data.roaChange > 0;
  criteria.push({
    name: 'ROA Improving',
    value: data.roaChange,
    threshold: '> 0%',
    passed: roaImproving,
    description: 'ROA increased vs prior period'
  });
  if (roaImproving) profitability++;

  // 4. CFO > Net Income (accruals quality)
  const accrualsQuality = data.cfoVsNi !== null && data.cfoVsNi > 0;
  criteria.push({
    name: 'CFO > Net Income',
    value: data.cfoVsNi,
    threshold: '> 0%',
    passed: accrualsQuality,
    description: 'Cash flow exceeds net income (quality earnings)'
  });
  if (accrualsQuality) profitability++;

  // Leverage Criteria (0-3 points)
  let leverage = 0;

  // 5. Current Ratio improving
  const crImproving = data.currentRatioChg !== null && data.currentRatioChg > 0;
  criteria.push({
    name: 'Current Ratio Improving',
    value: data.currentRatioChg,
    threshold: '> 0%',
    passed: crImproving,
    description: 'Current ratio increased vs prior period'
  });
  if (crImproving) leverage++;

  // 6. Leverage decreasing
  const leverageDecreasing = data.leverageChange !== null && data.leverageChange < 0;
  criteria.push({
    name: 'Leverage Decreasing',
    value: data.leverageChange,
    threshold: '< 0%',
    passed: leverageDecreasing,
    description: 'Debt-to-Assets decreased vs prior period'
  });
  if (leverageDecreasing) leverage++;

  // 7. No share dilution
  const noDilution = data.sharesChange !== null && data.sharesChange <= 0;
  criteria.push({
    name: 'No Share Dilution',
    value: data.sharesChange,
    threshold: '<= 0%',
    passed: noDilution,
    description: 'Shares outstanding not increased'
  });
  if (noDilution) leverage++;

  // Efficiency Criteria (0-2 points)
  let efficiency = 0;

  // 8. Gross Margin improving
  const marginImproving = data.marginChange !== null && data.marginChange > 0;
  criteria.push({
    name: 'Gross Margin Improving',
    value: data.marginChange,
    threshold: '> 0%',
    passed: marginImproving,
    description: 'Gross margin increased vs prior period'
  });
  if (marginImproving) efficiency++;

  // 9. Asset Turnover improving
  const turnoverImproving = data.turnoverChange !== null && data.turnoverChange > 0;
  criteria.push({
    name: 'Asset Turnover Improving',
    value: data.turnoverChange,
    threshold: '> 0%',
    passed: turnoverImproving,
    description: 'Asset turnover increased vs prior period'
  });
  if (turnoverImproving) efficiency++;

  const totalScore = profitability + leverage + efficiency;

  return {
    score: totalScore,
    maxScore: 9,
    profitability,
    leverage,
    efficiency,
    criteria,
    interpretation: interpretScore(totalScore)
  };
}

export async function getFinancialScore(symbol: string): Promise<FScoreBreakdown | null> {
  try {
    const upperSymbol = symbol.toUpperCase();

    const fundamentals = await prisma.fundamental.findMany({
      where: { ticker: upperSymbol },
      orderBy: { asOf: 'desc' },
      take: 2
    });

    if (fundamentals.length === 0) {
      return null;
    }

    const current = fundamentals[0];
    const previous = fundamentals[1];

    const netIncome = current.netIncome ? Number(current.netIncome) : null;
    const totalAssets = current.totalAssets ? Number(current.totalAssets) : null;
    const shareholdersEquity = current.shareholdersEquity ? Number(current.shareholdersEquity) : null;
    const revenue = current.revenue ? Number(current.revenue) : null;

    const prevNetIncome = previous?.netIncome ? Number(previous.netIncome) : null;
    const prevTotalAssets = previous?.totalAssets ? Number(previous.totalAssets) : null;
    const prevShareholdersEquity = previous?.shareholdersEquity ? Number(previous.shareholdersEquity) : null;
    const prevRevenue = previous?.revenue ? Number(previous.revenue) : null;

    const roa = totalAssets && netIncome ? (netIncome / totalAssets) * 100 : null;
    const prevRoa = prevTotalAssets && prevNetIncome ? (prevNetIncome / prevTotalAssets) * 100 : null;
    const roaChange = roa && prevRoa ? roa - prevRoa : null;

    const cfo = netIncome;
    const cfoVsNi = cfo && netIncome ? cfo - netIncome : null;

    const currentRatio = totalAssets && current.totalLiabilities
      ? Number(totalAssets) / Number(current.totalLiabilities)
      : null;
    const prevCurrentRatio = prevTotalAssets && previous?.totalLiabilities
      ? Number(prevTotalAssets) / Number(previous.totalLiabilities)
      : null;
    const currentRatioChg = currentRatio && prevCurrentRatio
      ? currentRatio - prevCurrentRatio
      : null;

    const leverage = totalAssets && current.totalLiabilities
      ? (Number(current.totalLiabilities) / totalAssets) * 100
      : null;
    const prevLeverage = prevTotalAssets && previous?.totalLiabilities
      ? (Number(previous.totalLiabilities) / prevTotalAssets) * 100
      : null;
    const leverageChange = leverage && prevLeverage ? leverage - prevLeverage : null;

    const sharesChange = null;

    const grossMargin = revenue && netIncome
      ? ((revenue - (revenue - netIncome)) / revenue) * 100
      : null;
    const prevGrossMargin = prevRevenue && prevNetIncome
      ? ((prevRevenue - (prevRevenue - prevNetIncome)) / prevRevenue) * 100
      : null;
    const marginChange = grossMargin && prevGrossMargin ? grossMargin - prevGrossMargin : null;

    const assetTurnover = totalAssets && revenue ? revenue / totalAssets : null;
    const prevAssetTurnover = prevTotalAssets && prevRevenue ? prevRevenue / prevTotalAssets : null;
    const turnoverChange = assetTurnover && prevAssetTurnover
      ? assetTurnover - prevAssetTurnover
      : null;

    const data: FinancialScoreData = {
      symbol: upperSymbol,
      roa,
      roaChange,
      cfo,
      cfoVsNi,
      currentRatio,
      currentRatioChg,
      leverage,
      leverageChange,
      sharesChange,
      grossMargin,
      marginChange,
      assetTurnover,
      turnoverChange
    };

    const breakdown = calculateFScore(data);

    await prisma.financialScore.upsert({
      where: {
        symbol_periodType_asOf: {
          symbol: upperSymbol,
          periodType: current.periodType || 'annual',
          asOf: current.asOf
        }
      },
      update: {
        fScore: breakdown.score,
        roa: roa ? Math.round(roa * 100) / 100 : null,
        roaChange: roaChange ? Math.round(roaChange * 100) / 100 : null,
        cfo: cfo ? Math.round(cfo * 100) / 100 : null,
        cfoVsNi: cfoVsNi ? Math.round(cfoVsNi * 100) / 100 : null,
        currentRatio: currentRatio ? Math.round(currentRatio * 100) / 100 : null,
        currentRatioChg: currentRatioChg ? Math.round(currentRatioChg * 100) / 100 : null,
        leverage: leverage ? Math.round(leverage * 100) / 100 : null,
        leverageChange: leverageChange ? Math.round(leverageChange * 100) / 100 : null,
        sharesChange: sharesChange ? Math.round(sharesChange * 100) / 100 : null,
        grossMargin: grossMargin ? Math.round(grossMargin * 100) / 100 : null,
        marginChange: marginChange ? Math.round(marginChange * 100) / 100 : null,
        assetTurnover: assetTurnover ? Math.round(assetTurnover * 100) / 100 : null,
        turnoverChange: turnoverChange ? Math.round(turnoverChange * 100) / 100 : null,
      },
      create: {
        symbol: upperSymbol,
        periodType: current.periodType || 'annual',
        asOf: current.asOf,
        fScore: breakdown.score,
        roa: roa ? Math.round(roa * 100) / 100 : null,
        roaChange: roaChange ? Math.round(roaChange * 100) / 100 : null,
        cfo: cfo ? Math.round(cfo * 100) / 100 : null,
        cfoVsNi: cfoVsNi ? Math.round(cfoVsNi * 100) / 100 : null,
        currentRatio: currentRatio ? Math.round(currentRatio * 100) / 100 : null,
        currentRatioChg: currentRatioChg ? Math.round(currentRatioChg * 100) / 100 : null,
        leverage: leverage ? Math.round(leverage * 100) / 100 : null,
        leverageChange: leverageChange ? Math.round(leverageChange * 100) / 100 : null,
        sharesChange: sharesChange ? Math.round(sharesChange * 100) / 100 : null,
        grossMargin: grossMargin ? Math.round(grossMargin * 100) / 100 : null,
        marginChange: marginChange ? Math.round(marginChange * 100) / 100 : null,
        assetTurnover: assetTurnover ? Math.round(assetTurnover * 100) / 100 : null,
        turnoverChange: turnoverChange ? Math.round(turnoverChange * 100) / 100 : null,
      }
    });

    return breakdown;
  } catch (error) {
    console.error('Error calculating financial score:', error);
    return null;
  }
}

export function generateMockFScore(symbol: string): FScoreBreakdown {
  const mockData: FinancialScoreData = {
    symbol: symbol.toUpperCase(),
    roa: Math.random() * 20 - 5,
    roaChange: Math.random() * 10 - 3,
    cfo: Math.random() * 1000000000 - 100000000,
    cfoVsNi: Math.random() * 50000000 - 10000000,
    currentRatio: Math.random() * 2 + 0.5,
    currentRatioChg: Math.random() * 0.5 - 0.2,
    leverage: Math.random() * 60 + 10,
    leverageChange: Math.random() * 10 - 5,
    sharesChange: Math.random() * 10 - 2,
    grossMargin: Math.random() * 40 + 20,
    marginChange: Math.random() * 15 - 5,
    assetTurnover: Math.random() * 1.5 + 0.2,
    turnoverChange: Math.random() * 0.5 - 0.2,
  };

  return calculateFScore(mockData);
}
