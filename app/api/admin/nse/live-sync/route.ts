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
  const purpose = item.PURPOSE || item.purpose || '';
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
    companyName: item['COMPANY NAME'] || item.companyName || "",
    series: item.SERIES || item.series || null,
    subject: purpose,
    actionType: parsed.actionType,
    exDate: exDate,
    recordDate: parseNseDate(item['RECORD DATE'] || item.recordDate || ""),
    faceValue: item['FACE VALUE'] || item.faceValue || item['FV'] || item.fv || null,
    ratio: parsed.ratio,
    dividendPerShare: dividendAmount,
    dividendYield: dividendYield,
    source: 'nse',
  };
}

async function hydrateCorporateActionsToDb(actions: any[]): Promise<number> {
  let hydrated = 0;
  
  for (const action of actions) {
    if (!action.symbol || !action.exDate) continue;
    
    try {
      const existing = await prisma.corporateAction.findFirst({
        where: {
          symbol: action.symbol,
          exDate: new Date(action.exDate)
        }
      });
      
      if (existing) {
        await prisma.corporateAction.update({
          where: { id: existing.id },
          data: {
            companyName: action.companyName || "",
            series: action.series,
            subject: action.subject || "",
            actionType: action.actionType || "OTHER",
            recordDate: action.recordDate ? new Date(action.recordDate) : null,
            faceValue: action.faceValue,
            ratio: action.ratio,
            dividendPerShare: action.dividendAmount,
            dividendYield: action.dividendYield,
            source: 'nse'
          }
        });
      } else {
        await prisma.corporateAction.create({
          data: {
            symbol: action.symbol,
            companyName: action.companyName || "",
            series: action.series,
            subject: action.subject || "",
            actionType: action.actionType || "OTHER",
            exDate: new Date(action.exDate),
            recordDate: action.recordDate ? new Date(action.recordDate) : null,
            faceValue: action.faceValue,
            ratio: action.ratio,
            dividendPerShare: action.dividendAmount,
            dividendYield: action.dividendYield,
            source: 'nse'
          }
        });
      }
      hydrated++;
    } catch (error) {
      logger.error({ msg: 'Error hydrating corporate action', symbol: action.symbol, error });
    }
  }
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
  let hydrated = 0;
  
  for (const ann of announcements) {
    if (!ann.symbol || !ann.broadcastDateTime) continue;
    
    try {
      const existing = await prisma.corporateAnnouncement.findFirst({
        where: {
          symbol: ann.symbol,
          broadcastDateTime: new Date(ann.broadcastDateTime)
        }
      });
      
      if (!existing) {
        await prisma.corporateAnnouncement.create({
          data: {
            symbol: ann.symbol,
            companyName: ann.companyName || "",
            subject: ann.subject || "",
            details: ann.details || null,
            broadcastDateTime: new Date(ann.broadcastDateTime),
            attachment: ann.attachment || null,
          }
        });
        hydrated++;
      }
    } catch (error) {
      logger.error({ msg: 'Error hydrating announcement', symbol: ann.symbol, error });
    }
  }
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
  let blockDealsCount = 0;
  let bulkDealsCount = 0;
  
  for (const deal of deals) {
    if (!deal.symbol || !deal.date) continue;
    
    try {
      // Handle block deals
      if (deal.dealType === 'BLOCK') {
        const existing = await prisma.blockDeal.findFirst({
          where: {
            symbol: deal.symbol,
            date: new Date(deal.date)
          }
        });
        
        if (!existing) {
          await prisma.blockDeal.create({
            data: {
              symbol: deal.symbol,
              securityName: deal.securityName || "",
              clientName: deal.clientName || "",
              quantityTraded: deal.quantityTraded || 0,
              tradePrice: deal.tradePrice || 0,
              buySell: deal.buySell || "",
              date: new Date(deal.date),
            }
          });
          blockDealsCount++;
        }
      } else {
        // Handle bulk deals
        const existing = await prisma.bulkDeal.findFirst({
          where: {
            symbol: deal.symbol,
            date: new Date(deal.date)
          }
        });
        
        if (!existing) {
          await prisma.bulkDeal.create({
            data: {
              symbol: deal.symbol,
              securityName: deal.securityName || "",
              clientName: deal.clientName || "",
              quantityTraded: deal.quantityTraded || 0,
              tradePrice: deal.tradePrice || 0,
              buySell: deal.buySell || "",
              date: new Date(deal.date),
            }
          });
          bulkDealsCount++;
        }
      }
    } catch (error) {
      logger.error({ msg: 'Error hydrating deal', symbol: deal.symbol, error });
    }
  }
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
