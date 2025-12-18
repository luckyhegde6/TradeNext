import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import cache from "@/lib/cache";
import { z } from "zod";
import logger from "@/lib/logger";

const announcementsQuerySchema = z.object({
    page: z.string().optional().transform(val => val ? parseInt(val) : 1),
    limit: z.string().optional().transform(val => val ? Math.min(parseInt(val), 100) : 20), // Max 100 per page
});

export const dynamic = 'force-dynamic'; // Ensure fresh data on request (but we use cache internally)

export async function GET(request: Request) {
    const startTime = Date.now();
    const CACHE_KEY = "corporate_announcements_latest";
    const cacheDuration = 60 * 5; // 5 minutes

    try {
        const url = new URL(request.url);
        const queryValidation = announcementsQuerySchema.safeParse({
            page: url.searchParams.get("page"),
            limit: url.searchParams.get("limit"),
        });

        if (!queryValidation.success) {
            logger.warn({ msg: 'Invalid announcements query parameters', errors: queryValidation.error.errors });
            return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 });
        }

        const { page, limit } = queryValidation.data;

        logger.info({ msg: 'Fetching announcements', page, limit });

        const cached = cache.get(CACHE_KEY);
        if (cached) {
            // Apply pagination to cached data
            const offset = (page - 1) * limit;
            const paginatedAnnouncements = cached.slice(offset, offset + limit);
            const total = cached.length;
            const totalPages = Math.ceil(total / limit);

            const duration = Date.now() - startTime;
            logger.info({ msg: 'Announcements served from cache', page, limit, count: paginatedAnnouncements.length, duration });

            return NextResponse.json({
                announcements: paginatedAnnouncements,
                pagination: { page, limit, total, totalPages }
            });
        }

        // Calculate offset for database query
        const offset = (page - 1) * limit;

        // Fetch paginated announcements and total count
        const [announcements, total] = await Promise.all([
            prisma.corporateAnnouncement.findMany({
                orderBy: {
                    broadcastDateTime: 'desc',
                },
                skip: offset,
                take: limit,
            }),
            prisma.corporateAnnouncement.count()
        ]);

        const totalPages = Math.ceil(total / limit);

        // Cache all announcements for future requests (only if this is the first page)
        if (page === 1 && announcements.length >= limit) {
            // Fetch all for caching in background
            (async () => {
                try {
                    const allAnnouncements = await prisma.corporateAnnouncement.findMany({
                        orderBy: { broadcastDateTime: 'desc' },
                        take: 200, // Cache up to 200 for performance
                    });
                    cache.set(CACHE_KEY, allAnnouncements, cacheDuration);
                    logger.debug({ msg: 'Announcements cached', count: allAnnouncements.length });
                } catch (cacheError) {
                    logger.warn({ msg: 'Failed to cache announcements', error: cacheError instanceof Error ? cacheError.message : String(cacheError) });
                }
            })();
        }

        const duration = Date.now() - startTime;
        logger.info({
            msg: 'Announcements fetched from database',
            page,
            limit,
            count: announcements.length,
            total,
            totalPages,
            duration
        });

        return NextResponse.json({
            announcements,
            pagination: { page, limit, total, totalPages }
        });
    } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ msg: 'Failed to fetch announcements', error: errorMessage, duration });
        return NextResponse.json({ error: "Failed to fetch announcements" }, { status: 500 });
    }
}
