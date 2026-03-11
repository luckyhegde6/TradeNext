import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const dealType = searchParams.get("dealType") || "bulk_deal";
        const date = searchParams.get("date"); // exact day match (backward compat)
        const fromDate = searchParams.get("fromDate"); // gte
        const toDate = searchParams.get("toDate"); // lte

        const where: Record<string, unknown> = {};

        // Exact single day match (for admin history)
        if (date && !fromDate) {
            const selectedDate = new Date(date);
            const nextDate = new Date(selectedDate);
            nextDate.setDate(nextDate.getDate() + 1);
            where.date = {
                gte: selectedDate,
                lt: nextDate,
            };
        }
        // Range query (gte, optionally lte)
        else if (fromDate) {
            const start = new Date(fromDate);
            where.date = { gte: start };
            if (toDate) {
                where.date = {
                    gte: start,
                    lte: new Date(toDate),
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
            totalCount = await prisma.blockDeal.count({ where });
        } else if (dealType === "bulk_deal") {
            data = await prisma.bulkDeal.findMany({
                where,
                orderBy: { date: "desc" },
                take: 1000,
            });
            totalCount = await prisma.bulkDeal.count({ where });
        } else if (dealType === "short_selling") {
            data = await prisma.shortSelling.findMany({
                where,
                orderBy: { date: "desc" },
                take: 1000,
            });
            totalCount = await prisma.shortSelling.count({ where });
        }

        // Get available dates
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

        return NextResponse.json({ 
            data, 
            totalCount, 
            availableDates: dates 
        });
    } catch (err) {
        console.error("Get deals error:", err);
        return NextResponse.json({ error: "Failed to fetch deals" }, { status: 500 });
    }
}
