import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { clearCache, forceRefreshCache } from "@/lib/market-cache";
import { createAuditLog } from "@/lib/audit";
import logger from "@/lib/logger";
import * as nseApi from "@/lib/nse-api";

// Import the corporate actions processing from the combined route
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SyncType = 
  | "advance_decline"
  | "corporate_actions"
  | "announcements"
  | "events"
  | "deals"
  | "volume"
  | "insider";

// Helper functions from corporate-actions route
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
    // Create date at noon UTC to avoid timezone issues with midnight
    const date = new Date(Date.UTC(parseInt(yr), month, parseInt(dd), 12, 0, 0, 0));
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
  let dividendAmount: number | undefined = undefined;
  let ratio: string | undefined = undefined;

  // Check for dividend in purpose - multiple patterns
  if (p.includes('dividend') || p.includes('interest payment')) {
    actionType = p.includes('interest') ? 'INTEREST' : 'DIVIDEND';
    // Try multiple patterns for dividend amount
    const patterns = [
      /Rs\s*([\d,.]+)\s*Per Share/i,
      /Rs\s*([\d,.]+)\s*\/\s*Share/i,
      /Rs\.?\s*([\d,.]+)/i,
      /₹\s*([\d,.]+)/i,
      /([\d,.]+)\s*Per Share/i,
      /final\s+dividend\s+([\d,.]+)/i,
      /interim\s+dividend\s+([\d,.]+)/i,
      /dividend\s+([\d,.]+)/i,
    ];
    for (const pattern of patterns) {
      const match = purpose.match(pattern);
      if (match) {
        const amount = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(amount) && amount > 0) {
          dividendAmount = amount;
          break;
        }
      }
    }
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

function parseCorporateActionFromNse(item: any): any | null {
  // NSE API uses 'subject' field, not 'PURPOSE'
  const purpose = item.PURPOSE || item.purpose || item.subject || '';
  const parsed = parsePurpose(purpose);
  const exDate = parseNseDate(item['EX-DATE'] || item.exDate || "");
  if (!exDate) return null;

  // Try to get dividend amount from multiple possible fields in NSE API
  let dividendAmount = parsed.dividendAmount || null;
  
  // Check if NSE API has a specific dividend amount field
  if (!dividendAmount) {
    const possibleFields = ['DIVIDEND_AMOUNT', 'dividendAmount', 'DIVIDEND', 'nd', ' Dividend'];
    for (const field of possibleFields) {
      if (item[field] !== undefined && item[field] !== null && item[field] !== '-') {
        const parsedVal = parseFloat(String(item[field]).replace(/,/g, ''));
        if (!isNaN(parsedVal) && parsedVal > 0) {
          dividendAmount = parsedVal;
          break;
        }
      }
    }
  }
  
  let dividendYield: number | null = null;
  if (dividendAmount) {
    const faceValue = item['FACE VALUE'] || item.faceValue || item['FV'] || item.fv;
    if (faceValue) {
      const fv = parseFloat(String(faceValue).replace(/,/g, ''));
      if (fv > 0) {
        dividendYield = (dividendAmount / fv) * 100;
      }
    }
  }

  return {
    symbol: item.SYMBOL || item.symbol || "",
    companyName: item['COMPANY NAME'] || item.companyName || item.comp || "",
    series: item.SERIES || item.series || null,
    subject: purpose,
    actionType: parsed.actionType,
    exDate: exDate,
    recordDate: parseNseDate(item['RECORD DATE'] || item.recordDate || item.recDate || ""),
    faceValue: item['FACE VALUE'] || item.faceValue || item['FV'] || item.fv || item.faceVal || null,
    ratio: parsed.ratio,
    dividendPerShare: dividendAmount,
    dividendYield: dividendYield,
    source: 'nse',
  };
}

async function hydrateCorporateActionsToDb(actions: any[]): Promise<number> {
  // Batch approach: collect all valid actions, createMany with skipDuplicates, then update existing
  // Reduces N individual upserts to ~N/200 + 1 queries
  const BATCH_SIZE = 200;
  const validActions = actions.filter(a => a.symbol && a.exDate);
  
  if (validActions.length === 0) return 0;

  let hydrated = 0;

  // Build insert data
  const insertData = validActions.map(action => {
    const exDate = new Date(action.exDate);
    return {
      symbol: action.symbol,
      companyName: action.companyName || "",
      series: action.series || null,
      subject: action.subject || "",
      actionType: action.actionType || "OTHER",
      exDate,
      recordDate: action.recordDate ? new Date(action.recordDate) : null,
      faceValue: action.faceValue || null,
      ratio: action.ratio || null,
      dividendPerShare: action.dividendPerShare ?? action.dividendAmount ?? null,
      dividendYield: action.dividendYield || null,
      source: 'nse',
    };
  });

  try {
    // Step 1: Insert all new records in batches (skip duplicates)
    for (let i = 0; i < insertData.length; i += BATCH_SIZE) {
      const batch = insertData.slice(i, i + BATCH_SIZE);
      const result = await prisma.corporateAction.createMany({
        data: batch,
        skipDuplicates: true,
      });
      hydrated += result.count;
    }

    // Step 2: Update existing records in batches (only changed fields)
    const uniqueSymbols = [...new Set(insertData.map(a => a.symbol))];
    const existingRecords = await prisma.corporateAction.findMany({
      where: {
        symbol: { in: uniqueSymbols },
      },
      select: { symbol: true, actionType: true, exDate: true },
    });
    const existingSet = new Set(existingRecords.map(r => `${r.symbol}|${r.actionType}|${r.exDate?.toISOString()}`));

    const toUpdate = insertData.filter(a => {
      const key = `${a.symbol}|${a.actionType}|${a.exDate.toISOString()}`;
      return existingSet.has(key);
    });

    for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
      const batch = toUpdate.slice(i, i + BATCH_SIZE);
      await prisma.$transaction(
        batch.map(a =>
          prisma.corporateAction.updateMany({
            where: {
              symbol: a.symbol,
              actionType: a.actionType,
              exDate: a.exDate,
            },
            data: {
              companyName: a.companyName,
              series: a.series,
              subject: a.subject,
              recordDate: a.recordDate,
              faceValue: a.faceValue,
              ratio: a.ratio,
              dividendPerShare: a.dividendPerShare,
              dividendYield: a.dividendYield,
              source: 'nse',
            },
          })
        )
      );
    }
  } catch (error) {
    logger.error({ msg: 'Error batch hydrating corporate actions', error });
  }

  logger.info({ msg: 'Corporate actions hydrated', total: validActions.length, hydrated });
  return hydrated;
}

// Helper to parse and save corporate announcements
function parseAnnouncementFromNse(item: any): any | null {
  const broadcastDate = item['ANNOUNCEMENT DATE'] || item.broadcastDate || item['BROADCAST DATE'];
  if (!broadcastDate) return null;
  
  return {
    symbol: item.SYMBOL || item.symbol || "",
    companyName: item['COMPANY NAME'] || item.companyName || "",
    subject: item.PURPOSE || item.desc || item.subject || "",
    details: item['ATTACHMENT NAME'] || item.attchmntText || null,
    broadcastDateTime: parseNseDate(broadcastDate),
    attachment: item['ATTACHMENT FILE NAME'] || item.attchmntFile || null,
  };
}

async function hydrateAnnouncementsToDb(announcements: any[]): Promise<number> {
  // Batch approach: createMany with skipDuplicates
  // Reduces 2N queries (find+create per record) to N/200 batches
  const BATCH_SIZE = 200;
  const validAnns = announcements.filter(a => a.symbol && a.broadcastDateTime);
  
  if (validAnns.length === 0) return 0;

  let hydrated = 0;

  const insertData = validAnns.map(ann => ({
    symbol: ann.symbol,
    companyName: ann.companyName || "",
    subject: ann.subject || "",
    details: ann.details || null,
    broadcastDateTime: new Date(ann.broadcastDateTime),
    attachment: ann.attachment || null,
  }));

  try {
    // createMany with skipDuplicates - requires a unique constraint on (symbol, broadcastDateTime)
    // If no unique constraint, fall back to individual findFirst+create with batched reads
    const existingRecords = await prisma.corporateAnnouncement.findMany({
      where: {
        symbol: { in: insertData.map(a => a.symbol) },
      },
      select: { symbol: true, broadcastDateTime: true },
    });
    const existingSet = new Set(
      existingRecords.map(r => `${r.symbol}|${r.broadcastDateTime?.toISOString()}`)
    );

    const newRecords = insertData.filter(a => {
      const key = `${a.symbol}|${a.broadcastDateTime.toISOString()}`;
      return !existingSet.has(key);
    });

    for (let i = 0; i < newRecords.length; i += BATCH_SIZE) {
      const batch = newRecords.slice(i, i + BATCH_SIZE);
      const result = await prisma.corporateAnnouncement.createMany({
        data: batch,
        skipDuplicates: true,
      });
      hydrated += result.count;
    }
  } catch (error) {
    logger.error({ msg: 'Error batch hydrating announcements', error });
  }

  logger.info({ msg: 'Announcements hydrated', total: validAnns.length, hydrated });
  return hydrated;
}

// Helper to parse and save block/bulk deals
function parseDealFromNse(item: any, dealType: 'BLOCK' | 'BULK'): any | null {
  const date = item['DEAL DATE'] || item.dealDate || item['BROADCAST DATE'] || item.date;
  if (!date) return null;
  
  return {
    symbol: item.SYMBOL || item.symbol || "",
    securityName: item['SECURITY NAME'] || item.securityName || "",
    clientName: item['CLIENT NAME'] || item.clientName || "",
    quantityTraded: parseInt((item['QUANTITY'] || item.quantity || item['QUANTITY TRADED'] || "0").replace(/,/g, '')),
    tradePrice: parseFloat((item['PRICE'] || item.price || item['TRADE PRICE'] || "0").replace(/,/g, '')),
    buySell: item['BUY/SELL'] || item.buySell || "",
    dealType,
    date: parseNseDate(date),
  };
}

async function hydrateDealsToDb(deals: any[]): Promise<{ blockDeals: number; bulkDeals: number }> {
  // Batch approach: split into block/bulk, batch find existing, then createMany new
  // Reduces 2N queries to ~N/200 + 2 batch queries
  const BATCH_SIZE = 200;
  const validDeals = deals.filter(d => d.symbol && d.date);
  
  const blockDealsData = validDeals.filter(d => d.dealType === 'BLOCK').map(d => ({
    symbol: d.symbol,
    securityName: d.securityName || "",
    clientName: d.clientName || "",
    quantityTraded: d.quantityTraded || 0,
    tradePrice: d.tradePrice || 0,
    buySell: d.buySell || "",
    date: new Date(d.date),
  }));

  const bulkDealsData = validDeals.filter(d => d.dealType !== 'BLOCK').map(d => ({
    symbol: d.symbol,
    securityName: d.securityName || "",
    clientName: d.clientName || "",
    quantityTraded: d.quantityTraded || 0,
    tradePrice: d.tradePrice || 0,
    buySell: d.buySell || "",
    date: new Date(d.date),
  }));

  let blockDealsCount = 0;
  let bulkDealsCount = 0;

  try {
    // Process block deals
    if (blockDealsData.length > 0) {
      const existingBlock = await prisma.blockDeal.findMany({
        where: { symbol: { in: blockDealsData.map(d => d.symbol) } },
        select: { symbol: true, date: true },
      });
      const blockExistingSet = new Set(existingBlock.map(r => `${r.symbol}|${r.date?.toISOString()}`));
      const newBlockDeals = blockDealsData.filter(d => !blockExistingSet.has(`${d.symbol}|${d.date.toISOString()}`));

      for (let i = 0; i < newBlockDeals.length; i += BATCH_SIZE) {
        const result = await prisma.blockDeal.createMany({
          data: newBlockDeals.slice(i, i + BATCH_SIZE),
          skipDuplicates: true,
        });
        blockDealsCount += result.count;
      }
    }

    // Process bulk deals
    if (bulkDealsData.length > 0) {
      const existingBulk = await prisma.bulkDeal.findMany({
        where: { symbol: { in: bulkDealsData.map(d => d.symbol) } },
        select: { symbol: true, date: true },
      });
      const bulkExistingSet = new Set(existingBulk.map(r => `${r.symbol}|${r.date?.toISOString()}`));
      const newBulkDeals = bulkDealsData.filter(d => !bulkExistingSet.has(`${d.symbol}|${d.date.toISOString()}`));

      for (let i = 0; i < newBulkDeals.length; i += BATCH_SIZE) {
        const result = await prisma.bulkDeal.createMany({
          data: newBulkDeals.slice(i, i + BATCH_SIZE),
          skipDuplicates: true,
        });
        bulkDealsCount += result.count;
      }
    }
  } catch (error) {
    logger.error({ msg: 'Error batch hydrating deals', error });
  }

  logger.info({ msg: 'Deals hydrated', blockDeals: blockDealsCount, bulkDeals: bulkDealsCount });
  return { blockDeals: blockDealsCount, bulkDeals: bulkDealsCount };
}

/**
 * POST /api/admin/nse/live-sync
 * Sync specific data type from NSE immediately
 * Body: { type: "advance_decline" | "corporate_actions" | "announcements" | "events" | "deals" | "volume" | "insider" }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session || !session.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { type, forceRefresh } = body as { type: SyncType; forceRefresh?: boolean };

    if (!type) {
      return NextResponse.json({ error: "Missing sync type" }, { status: 400 });
    }

    const startTime = Date.now();
    let result: any = { success: false, count: 0, message: "" };

    logger.info({ msg: "NSE Live Sync started", type, userId: session.user.id });

    switch (type) {
      case "advance_decline": {
        const data = await nseApi.fetchAdvanceDecline();
        result = {
          success: true,
          count: data.stocks.length,
          advances: data.advances,
          declines: data.declines,
          unchanged: data.unchanged,
          message: `Advance/Decline: ${data.advances} advances, ${data.declines} declines, ${data.unchanged} unchanged`
        };
        
        // Cache the result
        if (forceRefresh) {
          await forceRefreshCache(() => Promise.resolve(data), "advance_decline");
        }
        break;
      }

      case "corporate_actions": {
        // Fetch raw data from NSE
        const rawData = await nseApi.fetchCorporateActions();
        
        // Parse and process the data
        const processedData = rawData.map(parseCorporateActionFromNse).filter(Boolean);
        
        // Save to database with deduplication
        const savedCount = await hydrateCorporateActionsToDb(processedData);
        
        result = {
          success: true,
          count: processedData.length,
          savedToDb: savedCount,
          message: `Corporate Actions: ${processedData.length} records fetched, ${savedCount} saved to database`
        };
        
        // Also cache the processed data
        if (forceRefresh || true) {
          await forceRefreshCache(() => Promise.resolve(processedData), "corporate_actions");
        }
        break;
      }

      case "announcements": {
        // Fetch raw data from NSE
        const rawData = await nseApi.fetchCorporateAnnouncements();
        
        // Parse and process the data
        const processedData = rawData.map(parseAnnouncementFromNse).filter(Boolean);
        
        // Save to database with deduplication
        const savedCount = await hydrateAnnouncementsToDb(processedData);
        
        result = {
          success: true,
          count: processedData.length,
          savedToDb: savedCount,
          message: `Corporate Announcements: ${processedData.length} fetched, ${savedCount} saved to database`
        };
        
        if (forceRefresh || true) {
          await forceRefreshCache(() => Promise.resolve(processedData), "announcements");
        }
        break;
      }

      case "events": {
        const data = await nseApi.fetchEventCalendar();
        result = {
          success: true,
          count: data.length,
          message: `Event Calendar: ${data.length} events fetched`
        };
        
        if (forceRefresh) {
          await forceRefreshCache(() => Promise.resolve(data), "corporate_events");
        }
        break;
      }

      case "deals": {
        const data = await nseApi.fetchLargeDeals();
        
        // Parse deals into categories
        const allParsed: any[] = [];
        
        for (const item of data as any[]) {
          // Determine deal type based on the data
          const purpose = (item.PURPOSE || item.purpose || item.subject || "").toLowerCase();
          let dealType: 'BLOCK' | 'BULK' = 'BULK';
          
          if (purpose.includes('block')) {
            dealType = 'BLOCK';
          } else if (purpose.includes('bulk')) {
            dealType = 'BULK';
          }
          
          const parsed = parseDealFromNse(item, dealType);
          if (parsed) allParsed.push(parsed);
        }
        
        // Save to database
        const savedDeals = await hydrateDealsToDb(allParsed);
        
        // Categorize deals
        const blockDeals = data.filter((d: any) => {
          const p = (d.PURPOSE || d.purpose || "").toLowerCase();
          return p.includes('block');
        });
        const bulkDeals = data.filter((d: any) => {
          const p = (d.PURPOSE || d.purpose || "").toLowerCase();
          return p.includes('bulk') || !p.includes('block');
        });
        
        result = {
          success: true,
          count: data.length,
          savedToDb: savedDeals.blockDeals + savedDeals.bulkDeals,
          blockDeals: blockDeals.length,
          bulkDeals: bulkDeals.length,
          message: `Large Deals: ${data.length} fetched, ${savedDeals.blockDeals + savedDeals.bulkDeals} saved to DB`
        };
        
        if (forceRefresh || true) {
          await forceRefreshCache(() => Promise.resolve(data), "bulk_deals");
        }
        break;
      }

      case "volume": {
        const data = await nseApi.fetchVolumeAnalysis();
        result = {
          success: true,
          count: data.length,
          message: `Volume Analysis: ${data.length} stocks fetched`
        };
        
        if (forceRefresh) {
          await forceRefreshCache(() => Promise.resolve(data), "most_active");
        }
        break;
      }

      case "insider": {
        const data = await nseApi.fetchInsiderTrading();
        result = {
          success: true,
          count: data.length,
          message: `Insider Trading: ${data.length} records fetched`
        };
        
        if (forceRefresh) {
          await forceRefreshCache(() => Promise.resolve(data), "insider_trading");
        }
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown sync type: ${type}` }, { status: 400 });
    }

    const duration = Date.now() - startTime;

    // Create audit log
    await createAuditLog({
      action: 'ADMIN_NSE_LIVE_SYNC',
      resource: `NSE_SYNC_${type.toUpperCase()}`,
      metadata: {
        type,
        count: result.count,
        duration,
        success: result.success
      }
    });

    return NextResponse.json({
      ...result,
      duration,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error({ msg: "NSE Live Sync error", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ 
      error: "Failed to sync data from NSE",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

/**
 * GET /api/admin/nse/live-sync
 * Get status of available sync types
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Return available sync types with their status
    const syncTypes = [
      { 
        id: "advance_decline", 
        label: "Advance / Decline", 
        description: "Market breadth - advances, declines, unchanged",
        endpoint: "/api/live-analysis-advance, /api/live-analysis-decline, /api/live-analysis-unchanged"
      },
      { 
        id: "corporate_actions", 
        label: "Corporate Actions", 
        description: "Dividends, splits, bonus, rights, buybacks",
        endpoint: "/api/corporates-corporateActions"
      },
      { 
        id: "announcements", 
        label: "Corporate Announcements", 
        description: "Board meetings, results, closures",
        endpoint: "/api/corporate-announcements"
      },
      { 
        id: "events", 
        label: "Event Calendar", 
        description: "Earnings, dividends, AGMs",
        endpoint: "/api/event-calendar"
      },
      { 
        id: "deals", 
        label: "Large Deals", 
        description: "Block deals, bulk deals, short selling",
        endpoint: "/api/snapshot-capital-market-largedeal"
      },
      { 
        id: "volume", 
        label: "Volume Analysis", 
        description: "Most active stocks by volume",
        endpoint: "/api/live-analysis-stocksTraded"
      },
      { 
        id: "insider", 
        label: "Insider Trading", 
        description: "Promoter, stakeholder changes",
        endpoint: "/api/corporates-pit (daily) or /api/corporates-pit?index=equities&from_date=...&to_date=... (historical)"
      },
    ];

    return NextResponse.json({
      syncTypes,
      baseUrl: "https://www.nseindia.com",
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error({ msg: "NSE Live Sync GET error", error });
    return NextResponse.json({ error: "Failed to fetch sync types" }, { status: 500 });
  }
}
