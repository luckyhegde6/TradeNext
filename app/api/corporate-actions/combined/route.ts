// app/api/corporate-actions/combined/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { nseFetch } from "@/lib/nse-client";
import logger from "@/lib/logger";
import { poolQuery } from "@/lib/db/server";

function parseNseDate(dateStr: string): string | null {
  if (!dateStr || dateStr === "-") return null;
  try {
    const [dd, mon, yr] = dateStr.split('-');
    const monthMap: Record<string, number> = {
      'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
      'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11
    };
    const month = monthMap[mon.toUpperCase()];
    if (month === undefined) return null;
    const date = new Date(parseInt(yr), month, parseInt(dd));
    return isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
}

function parsePurpose(purpose: string): {
  actionType: string;
  dividendAmount?: number;
  ratio?: string;
} {
  const p = purpose.toLowerCase();
  let actionType = 'OTHER';
  let dividendAmount: number = undefined;
  let ratio: string = undefined;

  if (p.includes('dividend') || p.includes('interest payment')) {
    actionType = p.includes('interest') ? 'INTEREST' : 'DIVIDEND';
    const match = purpose.match(/Rs\s*([\d,.]+)\s*Per Share/i);
    if (match) dividendAmount = parseFloat(match[1].replace(/,/g, ''));
  } else if (p.includes('bonus')) {
    actionType = 'BONUS';
    const match = purpose.match(/bonus\s+(\d+:\d+)/i);
    if (match) ratio = match[1];
  } else if (p.includes('rights')) {
    actionType = 'RIGHTS';
    const ratioMatch = purpose.match(/rights\s+(\d+:\d+)/i);
    if (ratioMatch) ratio = ratioMatch[1];
  } else if (p.includes('split') || p.includes('face value split')) {
    actionType = 'SPLIT';
  } else if (p.includes('buyback')) {
    actionType = 'BUYBACK';
  } else if (p.includes('demerger')) {
    actionType = 'DEMERGER';
  } else if (p.includes('redemption')) {
    actionType = 'REDEMPTION';
  } else if (p.includes('distribution')) {
    actionType = 'DISTRIBUTION';
  }

  return { actionType, dividendAmount, ratio };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sourceParam = url.searchParams.get("source") || "all";
    const actionType = url.searchParams.get("type");
    const symbol = url.searchParams.get("symbol");
    const fromDate = url.searchParams.get("fromDate");
    const toDate = url.searchParams.get("toDate");
    const pageParam = url.searchParams.get("page");
    const limitParam = url.searchParams.get("limit");
   const page = pageParam ? parseInt(pageParam, 10) : undefined;
   const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    const includeAdmin = sourceParam === "all" || sourceParam === "admin";
    const includeNse = sourceParam === "all" || sourceParam === "nse";

    let adminActions: any[] = [];
    let nseActions: any[] = [];

    // Fetch admin-uploaded from DB
    if (includeAdmin) {
      const where: any = {};
      if (actionType) where.actionType = actionType;
      if (symbol) where.symbol = { contains: symbol.toUpperCase() };
      if (fromDate || toDate) {
        where.exDate = {};
        if (fromDate) where.exDate.gte = new Date(fromDate);
        if (toDate) {
          const endDate = new Date(toDate);
          endDate.setHours(23, 59, 59, 999);
          where.exDate.lte = endDate;
        }
      }

      adminActions = await prisma.corporateAction.findMany({
        where,
        select: {
          id: true,
          symbol: true,
          companyName: true,
          series: true,
          subject: true,
          actionType: true,
          exDate: true,
          recordDate: true,
          faceValue: true,
          ratio: true,
          dividendPerShare: true,
          source: true,
        },
      });
    }

    // Fetch from NSE
    if (includeNse) {
      try {
        const nseData = await nseFetch("/api/corporates-corporateActions?index=equities") as any[];
        if (Array.isArray(nseData)) {
          nseActions = nseData.map(item => {
            const parsed = parsePurpose(item.PURPOSE || item.purpose || '');
            const exDate = parseNseDate(item['EX-DATE'] || item.exDate || "");
            // Apply filters
            if (actionType && parsed.actionType !== actionType) return null;
            if (symbol && !(item.SYMBOL || item.symbol)?.toUpperCase().includes(symbol.toUpperCase())) return null;
            if (fromDate || toDate) {
              if (!exDate) return null;
              const exDt = new Date(exDate);
              if (fromDate && exDt < new Date(fromDate)) return null;
              if (toDate) {
                const toDt = new Date(toDate);
                toDt.setHours(23, 59, 59, 999);
                if (exDt > toDt) return null;
              }
            }
            return {
              id: null,
              symbol: item.SYMBOL || item.symbol || "",
              companyName: item['COMPANY NAME'] || item.companyName || "",
              series: item.SERIES || item.series || null,
              subject: item.PURPOSE || item.purpose || "",
              actionType: parsed.actionType,
              exDate: exDate,
              recordDate: parseNseDate(item['RECORD DATE'] || item.recordDate || ""),
              faceValue: item['FACE VALUE'] || item.faceValue || null,
              ratio: parsed.ratio,
              dividendPerShare: parsed.dividendAmount || null,
              source: 'nse',
            };
          }).filter(Boolean) as any[];
        }
      } catch (e) {
        logger.warn({ msg: "Failed to fetch NSE corporate actions for combined", error: e });
      }
    }

    // Merge and sort by exDate descending
    const combined = [...adminActions, ...nseActions].sort((a, b) => {
      const dateA = a.exDate ? new Date(a.exDate).getTime() : 0;
      const dateB = b.exDate ? new Date(b.exDate).getTime() : 0;
      return dateB - dateA;
    });

    // Remove duplicates and ensure valid symbols
    const seen = new Set<string>();
    const uniqueCombined = combined.filter(item => {
      // Skip items without valid symbol
      if (!item.symbol || typeof item.symbol !== 'string' || item.symbol.trim() === '') {
        return false;
      }
      // Exclude "OTHER" type as it's not a meaningful corporate action
      if (item.actionType === 'OTHER') return false;
      if (!item.exDate) return false; // require exDate
      const dateKey = new Date(item.exDate).toISOString().split('T')[0];
      const key = `${item.symbol}-${item.actionType}-${dateKey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Enrich with current price and compute dividend yield (simplified - price lookup disabled for now)
    const enrichedCombined = uniqueCombined.map(item => ({
      ...item,
      currentPrice: null,
      dividendYield: null,
    }));

    // Apply pagination only if both page and limit are provided
    let responseData = enrichedCombined;
    if (page !== undefined && limit !== undefined) {
      const total = enrichedCombined.length;
      const totalPages = Math.ceil(total / limit);
      const offset = (page - 1) * limit;
      responseData = enrichedCombined.slice(offset, offset + limit);
      
      logger.info({ msg: "Combined corporate actions", adminCount: adminActions.length, nseCount: nseActions.length, uniqueTotal: enrichedCombined.length, page, limit, returned: responseData.length });
      
      return NextResponse.json({ 
        data: responseData, 
        total, 
        page, 
        totalPages, 
        limit 
      });
    } else {
      // Return all data without pagination metadata
      logger.info({ msg: "Combined corporate actions", adminCount: adminActions.length, nseCount: nseActions.length, uniqueTotal: enrichedCombined.length });
      return NextResponse.json({ data: enrichedCombined });
    }

     return NextResponse.json({ data: enrichedCombined });
  } catch (e) {
    logger.error({ msg: "Failed to fetch combined corporate actions", error: e });
    return NextResponse.json({ error: "Failed to fetch corporate actions" }, { status: 500 });
  }
}
