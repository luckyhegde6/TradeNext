import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const query = searchParams.get("q");

        if (!query || query.length < 1) {
            return NextResponse.json({ symbols: [] });
        }

        const search = query.toUpperCase();

        const symbols = await prisma.symbol.findMany({
            where: {
                OR: [
                    { symbol: { contains: search } },
                    { companyName: { contains: query, mode: 'insensitive' } },
                ],
                isActive: true,
            },
            take: 15,
            select: {
                symbol: true,
                companyName: true,
            },
            orderBy: [
                { symbol: 'asc' }
            ]
        });

        return NextResponse.json({ symbols });
    } catch (error) {
        console.error("Symbol search error:", error);
        return NextResponse.json({ error: "Search failed" }, { status: 500 });
    }
}
