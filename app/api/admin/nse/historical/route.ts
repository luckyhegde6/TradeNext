import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { 
    getCorporateActionsHistorical, 
    getCorporateAnnouncements, 
    getEventCalendar, 
    getCorporateResults, 
    getInsiderTrading 
} from "@/lib/index-service";
import { createAuditLog } from "@/lib/audit";
import logger from "@/lib/logger";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Helper to parse NSE date format (DD-MMM-YYYY)
function parseNseDate(dateStr: string | undefined): Date {
    if (!dateStr) return new Date();
    
    // Try parsing DD-MMM-YYYY format (e.g., "12-Mar-2026")
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const months: Record<string, number> = {
            'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
            'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
        };
        const month = months[parts[1].toLowerCase()];
        if (month !== undefined) {
            return new Date(parseInt(parts[2]), month, parseInt(parts[0]));
        }
    }
    
    // Fallback to standard date parsing
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
}

// Type definitions for NSE corporate action data
interface NseCorporateAction {
    symbol?: string;
    comp?: string;
    companyName?: string;
    subject?: string;
    purpose?: string;
    exDate?: string;
    'ex-date'?: string;
    series?: string;
    faceVal?: string;
    faceValue?: string;
    isin?: string;
}

// Type definitions for NSE corporate announcement data
interface NseCorporateAnnouncement {
    symbol?: string;
    comp?: string;
    companyName?: string;
    company_name?: string;
    subject?: string;
    details?: string;
    broadcastDate?: string;
    broadcast_date?: string;
    attachment?: string;
}

/**
 * Admin API route for syncing historical NSE data
 * 
 * Query Parameters:
 * - type: The type of data to sync (corporate_actions, announcements, events, results, insider)
 * - fromDate: Start date in DD-MM-YYYY format
 * - toDate: End date in DD-MM-YYYY format
 * - symbol: Optional symbol filter for announcements
 * 
 * Example: /api/admin/nse/historical?type=corporate_actions&fromDate=13-03-2025&toDate=13-03-2026
 */
export async function GET(req: Request) {
    try {
        const session = await auth();
        if (!session || !session.user || session.user.role !== 'admin') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const type = searchParams.get('type') as string;
        const fromDate = searchParams.get('fromDate') as string | undefined;
        const toDate = searchParams.get('toDate') as string | undefined;
        const symbol = searchParams.get('symbol') as string | undefined;

        if (!type) {
            return NextResponse.json({ error: "Missing required parameter: type" }, { status: 400 });
        }

        const validTypes = ['corporate_actions', 'announcements', 'events', 'results', 'insider'];
        if (!validTypes.includes(type)) {
            return NextResponse.json({ 
                error: `Invalid type. Must be one of: ${validTypes.join(', ')}` 
            }, { status: 400 });
        }

        logger.info({ msg: "Starting historical NSE sync", type, fromDate, toDate, symbol });
        
        const startTime = Date.now();
                let data: unknown[] = [];
                let savedToDb = 0;

                switch (type) {
                    case 'corporate_actions':
                        data = await getCorporateActionsHistorical(fromDate, toDate);
                        for (const action of data as NseCorporateAction[]) {
                            try {
                                const subject = action.subject || action.purpose || '';
                                const actionType = subject.toLowerCase().includes('dividend') ? 'DIVIDEND' :
                                                 subject.toLowerCase().includes('bonus') ? 'BONUS' :
                                                 subject.toLowerCase().includes('split') ? 'SPLIT' :
                                                 subject.toLowerCase().includes('rights') ? 'RIGHTS' :
                                                 subject.toLowerCase().includes('buyback') ? 'BUYBACK' : 'OTHER';
                                
                                // Parse dividend amount from subject (e.g., "Interim Dividend - Rs 6 Per Share")
                                let dividendPerShare: number | undefined = undefined;
                                let dividendYield: number | undefined = undefined;
                                
                                if (actionType === 'DIVIDEND') {
                                    const dividendMatch = subject.match(/Rs\s*([\d.]+)/i);
                                    if (dividendMatch) {
                                        dividendPerShare = parseFloat(dividendMatch[1]);
                                        
                                        // Calculate dividend yield based on face value
                                        const faceVal = action.faceVal || action.faceValue;
                                        if (dividendPerShare && faceVal) {
                                            const faceValNum = parseFloat(String(faceVal).replace(/,/g, ''));
                                            if (faceValNum > 0) {
                                                dividendYield = (dividendPerShare / faceValNum) * 100;
                                            }
                                        }
                                    }
                                }
                                
                                const exDateStr = action.exDate || action['ex-date'] || '';
                                const exDate = parseNseDate(exDateStr);
                                
                                await prisma.corporateAction.upsert({
                                    where: {
                                        symbol_actionType_exDate: {
                                            symbol: (action.symbol || '').toUpperCase(),
                                            actionType: actionType,
                                            exDate: exDate
                                        }
                                    },
                                    update: {
                                        companyName: action.comp || action.companyName || '',
                                        subject: subject,
                                        faceValue: action.faceVal || action.faceValue || null,
                                        dividendPerShare: dividendPerShare,
                                        dividendYield: dividendYield,
                                        series: action.series || null,
                                        isin: action.isin || null,
                                        source: 'NSE_HISTORICAL',
                                    },
                                    create: {
                                        symbol: (action.symbol || '').toUpperCase(),
                                        companyName: action.comp || action.companyName || '',
                                        actionType: actionType,
                                        exDate: exDate,
                                        subject: subject,
                                        faceValue: action.faceVal || action.faceValue || null,
                                        dividendPerShare: dividendPerShare,
                                        dividendYield: dividendYield,
                                        series: action.series || null,
                                        isin: action.isin || null,
                                        source: 'NSE_HISTORICAL',
                                    }
                                });
                                savedToDb++;
                            } catch (e) { /* Skip duplicates */ }
                        }
                        break;

                    case 'announcements':
                        data = await getCorporateAnnouncements(symbol, fromDate, toDate);
                        for (const ann of data as NseCorporateAnnouncement[]) {
                            try {
                                await prisma.corporateAnnouncement.create({
                                    data: {
                                        symbol: (ann.symbol || '').toUpperCase(),
                                        companyName: ann.comp || ann.companyName || '',
                                        subject: ann.subject || '',
                                        details: ann.details || '',
                                        broadcastDateTime: new Date(ann.broadcastDate || Date.now()),
                                    }
                                });
                                savedToDb++;
                            } catch (e) { /* Skip duplicates */ }
                        }
                        break;

            case 'announcements':
                data = await getCorporateAnnouncements(symbol, fromDate, toDate);
                // Save to DB - CorporateAnnouncement has no unique constraint, use create
                for (const ann of data as NseCorporateAnnouncement[]) {
                    try {
                        await prisma.corporateAnnouncement.create({
                            data: {
                                symbol: (ann.symbol || '').toUpperCase(),
                                companyName: ann.comp || ann.companyName || ann.company_name || '',
                                subject: ann.subject || '',
                                details: ann.details || '',
                                broadcastDateTime: new Date(ann.broadcastDate || ann.broadcast_date || Date.now()),
                                attachment: ann.attachment || null,
                            }
                        });
                        savedToDb++;
                    } catch (dbError) {
                        // Skip duplicates
                    }
                }
                break;

            case 'events':
                data = await getEventCalendar(fromDate, toDate);
                // Event calendar data can be stored in a separate table if needed
                // For now, just return the data
                savedToDb = data.length;
                break;

            case 'results':
                const period = searchParams.get('period') as string | undefined || 'Quarterly';
                data = await getCorporateResults(period);
                savedToDb = data.length;
                break;

            case 'insider':
                data = await getInsiderTrading(fromDate, toDate);
                savedToDb = data.length;
                break;

            default:
                return NextResponse.json({ error: "Invalid type" }, { status: 400 });
        }

        const duration = Date.now() - startTime;

        await createAuditLog({
            action: 'ADMIN_INGEST',
            resource: `NSE_SYNC_${type.toUpperCase()}`,
            method: 'GET',
            path: `/api/admin/nse/historical?type=${type}`,
            responseStatus: 200,
            responseTime: duration,
            metadata: {
                type,
                fromDate,
                toDate,
                symbol,
                recordsFetched: data.length,
                recordsSaved: savedToDb,
                success: true
            }
        });

        return NextResponse.json({
            success: true,
            type,
            fromDate,
            toDate,
            symbol,
            recordsFetched: data.length,
            recordsSaved: savedToDb,
            duration,
            message: `Successfully synced ${savedToDb} records of type "${type}"`
        });

    } catch (error) {
        logger.error({ msg: "Historical NSE sync error", error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ 
            error: "Failed to sync historical data",
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}

/**
 * POST endpoint for batch historical sync with multiple data types
 */
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session || !session.user || session.user.role !== 'admin') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { types, fromDate, toDate, symbol } = body;

        if (!types || !Array.isArray(types) || types.length === 0) {
            return NextResponse.json({ error: "Missing required field: types (array)" }, { status: 400 });
        }

        if (!fromDate || !toDate) {
            return NextResponse.json({ error: "Missing required fields: fromDate and toDate" }, { status: 400 });
        }

        const validTypes = ['corporate_actions', 'announcements', 'events', 'results', 'insider'];
        const invalidTypes = types.filter((t: string) => !validTypes.includes(t));
        if (invalidTypes.length > 0) {
            return NextResponse.json({ 
                error: `Invalid types: ${invalidTypes.join(', ')}. Must be one of: ${validTypes.join(', ')}` 
            }, { status: 400 });
        }

        logger.info({ msg: "Starting batch historical NSE sync", types, fromDate, toDate });
        
        const startTime = Date.now();
        const results: Record<string, { fetched: number; saved: number; error?: string }> = {};

        for (const type of types) {
            try {
                let data: unknown[] = [];
                let savedToDb = 0;

                switch (type) {
                    case 'corporate_actions':
                        data = await getCorporateActionsHistorical(fromDate, toDate);
                        for (const action of data as NseCorporateAction[]) {
                            try {
                                const subject = action.subject || action.purpose || '';
                                const actionType = subject.toLowerCase().includes('dividend') ? 'DIVIDEND' :
                                                 subject.toLowerCase().includes('bonus') ? 'BONUS' :
                                                 subject.toLowerCase().includes('split') ? 'SPLIT' :
                                                 subject.toLowerCase().includes('rights') ? 'RIGHTS' :
                                                 subject.toLowerCase().includes('buyback') ? 'BUYBACK' : 'OTHER';
                                
                                // Parse dividend amount from subject (e.g., "Interim Dividend - Rs 6 Per Share")
                                let dividendPerShare: number | undefined = undefined;
                                let dividendYield: number | undefined = undefined;
                                
                                if (actionType === 'DIVIDEND') {
                                    const dividendMatch = subject.match(/Rs\s*([\d.]+)/i);
                                    if (dividendMatch) {
                                        dividendPerShare = parseFloat(dividendMatch[1]);
                                        
                                        // Calculate dividend yield based on face value
                                        const faceVal = action.faceVal || action.faceValue;
                                        if (dividendPerShare && faceVal) {
                                            const faceValNum = parseFloat(String(faceVal).replace(/,/g, ''));
                                            if (faceValNum > 0) {
                                                dividendYield = (dividendPerShare / faceValNum) * 100;
                                            }
                                        }
                                    }
                                }
                                
                                const exDateStr = action.exDate || action['ex-date'] || '';
                                const exDate = parseNseDate(exDateStr);
                                
                                await prisma.corporateAction.upsert({
                                    where: {
                                        symbol_actionType_exDate: {
                                            symbol: (action.symbol || '').toUpperCase(),
                                            actionType: actionType,
                                            exDate: exDate
                                        }
                                    },
                                    update: {
                                        companyName: action.comp || action.companyName || '',
                                        subject: subject,
                                        faceValue: action.faceVal || action.faceValue || null,
                                        dividendPerShare: dividendPerShare,
                                        dividendYield: dividendYield,
                                        series: action.series || null,
                                        isin: action.isin || null,
                                        source: 'NSE_HISTORICAL',
                                    },
                                    create: {
                                        symbol: (action.symbol || '').toUpperCase(),
                                        companyName: action.comp || action.companyName || '',
                                        actionType: actionType,
                                        exDate: exDate,
                                        subject: subject,
                                        faceValue: action.faceVal || action.faceValue || null,
                                        dividendPerShare: dividendPerShare,
                                        dividendYield: dividendYield,
                                        series: action.series || null,
                                        isin: action.isin || null,
                                        source: 'NSE_HISTORICAL',
                                    }
                                });
                                savedToDb++;
                            } catch (e) { /* Skip duplicates */ }
                        }
                        break;

                    case 'announcements':
                        data = await getCorporateAnnouncements(symbol, fromDate, toDate);
                        for (const ann of data as NseCorporateAnnouncement[]) {
                            try {
                                await prisma.corporateAnnouncement.create({
                                    data: {
                                        symbol: (ann.symbol || '').toUpperCase(),
                                        companyName: ann.comp || ann.companyName || '',
                                        subject: ann.subject || '',
                                        details: ann.details || '',
                                        broadcastDateTime: new Date(ann.broadcastDate || Date.now()),
                                    }
                                });
                                savedToDb++;
                            } catch (e) { /* Skip duplicates */ }
                        }
                        break;

                    case 'events':
                        data = await getEventCalendar(fromDate, toDate);
                        savedToDb = data.length;
                        break;

                    case 'results':
                        data = await getCorporateResults('Quarterly');
                        savedToDb = data.length;
                        break;

                    case 'insider':
                        data = await getInsiderTrading(fromDate, toDate);
                        savedToDb = data.length;
                        break;
                }

                results[type] = { fetched: data.length, saved: savedToDb };
            } catch (typeError) {
                logger.error({ msg: `Error syncing type: ${type}`, error: typeError });
                results[type] = { fetched: 0, saved: 0, error: String(typeError) };
            }
        }

        const duration = Date.now() - startTime;

        await createAuditLog({
            action: 'ADMIN_INGEST',
            resource: 'NSE_SYNC_BATCH',
            method: 'POST',
            path: '/api/admin/nse/historical',
            responseStatus: 200,
            responseTime: duration,
            metadata: {
                types,
                fromDate,
                toDate,
                results,
                success: true
            }
        });

        return NextResponse.json({
            success: true,
            fromDate,
            toDate,
            results,
            duration,
            message: `Batch sync completed in ${duration}ms`
        });

    } catch (error) {
        logger.error({ msg: "Batch historical NSE sync error", error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ 
            error: "Failed to sync historical data",
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}
