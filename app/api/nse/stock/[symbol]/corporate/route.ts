import { NextResponse } from "next/server";
import { getFinancialStatus, getCorpEvents, getCorporateAnnouncements, getCorpActions } from "@/lib/stock-service";

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
    const { symbol } = await params;
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "all";

    try {
        if (type === "financials") {
            const data = await getFinancialStatus(symbol);
            return NextResponse.json(data);
        } else if (type === "events") {
            const data = await getCorpEvents(symbol);
            return NextResponse.json(data);
        } else if (type === "announcements") {
            const data = await getCorporateAnnouncements(symbol);
            return NextResponse.json(data);
        } else if (type === "actions") {
            const data = await getCorpActions(symbol);
            return NextResponse.json(data);
        } else {
            // Fetch everything in parallel
            const [financials, events, announcements, actions] = await Promise.all([
                getFinancialStatus(symbol),
                getCorpEvents(symbol),
                getCorporateAnnouncements(symbol),
                getCorpActions(symbol)
            ]);

            return NextResponse.json({
                financials,
                events,
                announcements,
                actions
            });
        }
    } catch (e) {
        console.error("Stock Corporate API Error:", e);
        return NextResponse.json({ error: "Failed to fetch corporate data" }, { status: 502 });
    }
}
