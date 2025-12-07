import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import cache from "@/lib/cache";

export const dynamic = 'force-dynamic'; // Ensure fresh data on request (but we use cache internally)

export async function GET() {
    const CACHE_KEY = "corporate_announcements_latest";
    const cacheDuration = 60 * 5; // 5 minutes

    const cached = cache.get(CACHE_KEY);
    if (cached) {
        return NextResponse.json(cached);
    }

    try {
        // Fetch latest 50 announcements
        const announcements = await prisma.corporateAnnouncement.findMany({
            orderBy: {
                broadcastDateTime: 'desc',
            },
            take: 50,
        });

        cache.set(CACHE_KEY, announcements, cacheDuration);
        return NextResponse.json(announcements);
    } catch {
        return NextResponse.json({ error: "Failed to fetch announcements" }, { status: 500 });
    }
}
