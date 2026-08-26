import { NextResponse } from "next/server";
import { getFinancialStatus, getCorpEvents, getCorporateAnnouncements, getCorpActions } from "@/lib/stock-service";
import logger from "@/lib/logger";

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
            const [financials, events, announcements, actions] = await Promise.allSettled([
                getFinancialStatus(symbol),
                getCorpEvents(symbol),
                getCorporateAnnouncements(symbol),
                getCorpActions(symbol)
            ]);

            return NextResponse.json({
                financials: financials.status === "fulfilled" ? financials.value : null,
                events: events.status === "fulfilled" ? events.value : null,
                announcements: announcements.status === "fulfilled" ? announcements.value : null,
                actions: actions.status === "fulfilled" ? actions.value : null,
            });
        }
    } catch (e) {
        logger.warn({ msg: "Stock Corporate: fetch failed", symbol, error: e instanceof Error ? e.message : String(e) });
        return NextResponse.json({ financials: null, events: null, announcements: null, actions: null });
    }
}
