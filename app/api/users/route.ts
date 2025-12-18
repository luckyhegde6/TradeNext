import { NextResponse } from "next/server";
import { getAllUsers, getPaginatedUsers } from "@/lib/services/userService";
import logger from "@/lib/logger";
import { z } from "zod";

const usersQuerySchema = z.object({
    page: z.string().optional().transform(val => val ? parseInt(val) : 1),
    limit: z.string().optional().transform(val => val ? parseInt(val) : 20),
    paginate: z.string().optional().transform(val => val === 'true'),
});

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const startTime = Date.now();

    try {
        const url = new URL(request.url);
        const queryValidation = usersQuerySchema.safeParse({
            page: url.searchParams.get("page"),
            limit: url.searchParams.get("limit"),
            paginate: url.searchParams.get("paginate"),
        });

        if (!queryValidation.success) {
            logger.warn({ msg: 'Invalid users query parameters', errors: queryValidation.error.errors });
            return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 });
        }

        const { page, limit, paginate } = queryValidation.data;

        if (paginate) {
            logger.info({ msg: 'Fetching paginated users', page, limit });

            const result = await getPaginatedUsers(page, limit);

            const duration = Date.now() - startTime;
            logger.info({
                msg: 'Users fetched successfully',
                page,
                limit,
                count: result.users.length,
                total: result.total,
                totalPages: result.totalPages,
                duration
            });

            return NextResponse.json(result);
        } else {
            logger.info({ msg: 'Fetching all users' });

            const users = await getAllUsers();

            const duration = Date.now() - startTime;
            logger.info({ msg: 'Users fetched successfully', count: users.length, duration });

            return NextResponse.json({ users });
        }
    } catch (err: unknown) {
        const duration = Date.now() - startTime;
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error({ msg: 'Failed to fetch users', error: errorMessage, duration });
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
