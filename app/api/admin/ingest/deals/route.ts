import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import fs from "fs";
import path from "path";

interface ParsedRow {
    date: string;
    symbol: string;
    security_name?: string;
    securityName?: string;
    client_name?: string;
    clientName?: string;
    buy_sell?: string;
    buySell?: string;
    quantity_traded?: string;
    quantitytraded?: string;
    quantity?: string;
    trade_price?: string;
    trade_price_wght_avg_price?: string;
    tradePrice?: string;
    remarks?: string;
    // Corporate Actions fields
    purpose?: string;
    company_name?: string;
    ex_date?: string;
    record_date?: string;
    book_closure_start_date?: string;
    book_closure_end_date?: string;
    face_value?: string;
    facevalue?: string;
    // Announcements fields
    subject?: string;
    details?: string;
    broadcast_date?: string;
    attachment?: string;
}

function parseCSV(content: string): ParsedRow[] {
    const lines = content.split("\n").filter(line => line.trim());
    if (lines.length < 2) return [];

    const headers = lines[0].split(",").map(h => h.replace(/"/g, "").trim().toLowerCase().replace(/\s+/g, "_"));
    
    const results: ParsedRow[] = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values: string[] = [];
        let current = "";
        let inQuotes = false;
        
        for (const char of lines[i]) {
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === "," && !inQuotes) {
                values.push(current.replace(/"/g, "").trim());
                current = "";
            } else {
                current += char;
            }
        }
        values.push(current.replace(/"/g, "").trim());
        
        if (values.length >= 2 && values[1]) {
            const row: Record<string, string> = {};
            headers.forEach((header, index) => {
                row[header] = values[index] || "";
            });
            results.push(row as unknown as ParsedRow);
        }
    }
    
    return results;
}

function parseIndianNumber(str: string): number {
    if (!str) return 0;
    return parseInt(str.replace(/,/g, ""), 10) || 0;
}

function parsePrice(str: string): number {
    if (!str) return 0;
    return parseFloat(str.replace(/,/g, "")) || 0;
}

function parseDate(dateStr: string): Date {
    if (!dateStr) return new Date();
    const parts = dateStr.trim().split("-");
    if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const months: Record<string, number> = {
            "jan": 0, "feb": 1, "mar": 2, "apr": 3, "may": 4, "jun": 5,
            "jul": 6, "aug": 7, "sep": 8, "oct": 9, "nov": 10, "dec": 11
        };
        const month = months[parts[1].toLowerCase()] || 0;
        const year = parseInt(parts[2], 10);
        return new Date(year, month, day);
    }
    return new Date();
}

export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== "admin") {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const formData = await req.formData();
        const csvFile = formData.get("file") as File | null;
        const dealType = formData.get("dealType") as string;

        if (!csvFile || !dealType) {
            return NextResponse.json({ error: "File and deal type required" }, { status: 400 });
        }

        const allowedTypes = [
            "block_deal", 
            "bulk_deal", 
            "short_selling",
            "corporate_actions",
            "announcements",
            "events",
            "results",
            "insider"
        ];
        
        if (!allowedTypes.includes(dealType)) {
            return NextResponse.json({ error: "Invalid deal type" }, { status: 400 });
        }

        const bytes = await csvFile.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const content = buffer.toString("utf-8");
        
        const rows = parseCSV(content);
        
        if (rows.length === 0) {
            return NextResponse.json({ error: "No valid data found in CSV" }, { status: 400 });
        }

        let insertedCount = 0;

        if (dealType === "block_deal") {
            for (const row of rows) {
                try {
                    await prisma.blockDeal.create({
                        data: {
                            date: parseDate(row.date),
                            symbol: row.symbol?.trim() || "",
                            securityName: row.security_name?.trim() || "",
                            clientName: row.client_name?.trim() || "",
                            buySell: row.buy_sell?.trim() || "",
                            quantityTraded: parseIndianNumber(row.quantity_traded || row.quantitytraded || ""),
                            tradePrice: parsePrice(row.trade_price || row.trade_price_wght_avg_price || ""),
                            remarks: row.remarks?.trim() || null,
                        },
                    });
                    insertedCount++;
                } catch (e) {
                    console.error("Error inserting block deal:", e);
                }
            }
        } else if (dealType === "bulk_deal") {
            for (const row of rows) {
                try {
                    await prisma.bulkDeal.create({
                        data: {
                            date: parseDate(row.date),
                            symbol: row.symbol?.trim() || "",
                            securityName: row.security_name?.trim() || "",
                            clientName: row.client_name?.trim() || "",
                            buySell: row.buy_sell?.trim() || "",
                            quantityTraded: parseIndianNumber(row.quantity_traded || row.quantitytraded || ""),
                            tradePrice: parsePrice(row.trade_price || row.trade_price_wght_avg_price || ""),
                            remarks: row.remarks?.trim() || null,
                        },
                    });
                    insertedCount++;
                } catch (e) {
                    console.error("Error inserting bulk deal:", e);
                }
            }
        } else if (dealType === "short_selling") {
            for (const row of rows) {
                try {
                    await prisma.shortSelling.create({
                        data: {
                            date: parseDate(row.date),
                            symbol: row.symbol?.trim() || "",
                            securityName: row.security_name?.trim() || "",
                            quantity: parseIndianNumber(row.quantity || ""),
                        },
                    });
                    insertedCount++;
                } catch (e) {
                    console.error("Error inserting short selling:", e);
                }
            }
        } else if (dealType === "corporate_actions") {
            // Parse corporate actions CSV - format: SYMBOL, COMPANY NAME, SERIES, PURPOSE, FACE VALUE, EX-DATE, RECORD DATE, etc.
            for (const row of rows) {
                try {
                    const purpose = row.purpose || row.subject || "";
                    const actionType = purpose.toLowerCase().includes('dividend') ? 'DIVIDEND' :
                                     purpose.toLowerCase().includes('bonus') ? 'BONUS' :
                                     purpose.toLowerCase().includes('split') ? 'SPLIT' :
                                     purpose.toLowerCase().includes('rights') ? 'RIGHTS' :
                                     purpose.toLowerCase().includes('buyback') ? 'BUYBACK' : 'OTHER';
                    
                    await prisma.corporateAction.create({
                        data: {
                            symbol: row.symbol?.trim() || "",
                            companyName: row.company_name?.trim() || "",
                            actionType,
                            subject: purpose,
                            exDate: row.ex_date ? parseDate(row.ex_date) : new Date(),
                            recordDate: row.record_date ? parseDate(row.record_date) : null,
                            bookClosureStartDate: row.book_closure_start_date ? parseDate(row.book_closure_start_date) : null,
                            bookClosureEndDate: row.book_closure_end_date ? parseDate(row.book_closure_end_date) : null,
                            faceValue: String(parsePrice(row.face_value || row.facevalue || "0")),
                            source: 'CSV_UPLOAD',
                        },
                    });
                    insertedCount++;
                } catch (e) {
                    console.error("Error inserting corporate action:", e);
                }
            }
        } else if (dealType === "announcements") {
            // Parse announcements CSV
            for (const row of rows) {
                try {
                    await prisma.corporateAnnouncement.create({
                        data: {
                            symbol: row.symbol?.trim() || "",
                            companyName: row.company_name?.trim() || "",
                            subject: row.subject?.trim() || "",
                            details: row.details?.trim() || "",
                            broadcastDateTime: row.broadcast_date ? parseDate(row.broadcast_date) : new Date(),
                            attachment: row.attachment?.trim() || null,
                        },
                    });
                    insertedCount++;
                } catch (e) {
                    console.error("Error inserting announcement:", e);
                }
            }
        }
        // Events, Results, and Insider can be added similarly based on the CSV format

        return NextResponse.json({ 
            success: true, 
            count: insertedCount,
            dealType 
        });
    } catch (err) {
        console.error("CSV upload error:", err);
        return NextResponse.json({ error: "Failed to process CSV" }, { status: 500 });
    }
}

export async function GET(req: Request) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== "admin") {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const dealType = searchParams.get("dealType");
        const date = searchParams.get("date");

        const where: Record<string, unknown> = {};
        
        if (dealType && ["block_deal", "bulk_deal", "short_selling"].includes(dealType)) {
            if (date) {
                const selectedDate = new Date(date);
                const nextDate = new Date(selectedDate);
                nextDate.setDate(nextDate.getDate() + 1);
                where.date = {
                    gte: selectedDate,
                    lt: nextDate,
                };
            }
        }

        let data: unknown[] = [];
        let totalCount = 0;

        if (dealType === "block_deal") {
            data = await prisma.blockDeal.findMany({
                where,
                orderBy: { date: "desc" },
                take: 1000,
            });
            totalCount = await prisma.blockDeal.count();
        } else if (dealType === "bulk_deal") {
            data = await prisma.bulkDeal.findMany({
                where,
                orderBy: { date: "desc" },
                take: 1000,
            });
            totalCount = await prisma.bulkDeal.count();
        } else if (dealType === "short_selling") {
            data = await prisma.shortSelling.findMany({
                where,
                orderBy: { date: "desc" },
                take: 1000,
            });
            totalCount = await prisma.shortSelling.count();
        }

        const dates = await getAvailableDates(dealType);

        return NextResponse.json({ data, totalCount, availableDates: dates });
    } catch (err) {
        console.error("Get deals error:", err);
        return NextResponse.json({ error: "Failed to fetch deals" }, { status: 500 });
    }
}

async function getAvailableDates(dealType: string | null): Promise<string[]> {
    if (!dealType) return [];
    
    let dates: string[] = [];
    
    if (dealType === "block_deal") {
        const result = await prisma.blockDeal.findMany({
            select: { date: true },
            distinct: ["date"],
            orderBy: { date: "desc" },
            take: 100,
        });
        dates = result.map(r => r.date.toISOString().split("T")[0]);
    } else if (dealType === "bulk_deal") {
        const result = await prisma.bulkDeal.findMany({
            select: { date: true },
            distinct: ["date"],
            orderBy: { date: "desc" },
            take: 100,
        });
        dates = result.map(r => r.date.toISOString().split("T")[0]);
    } else if (dealType === "short_selling") {
        const result = await prisma.shortSelling.findMany({
            select: { date: true },
            distinct: ["date"],
            orderBy: { date: "desc" },
            take: 100,
        });
        dates = result.map(r => r.date.toISOString().split("T")[0]);
    }
    
    return dates;
}
