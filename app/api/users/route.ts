import { NextResponse } from "next/server";
import { getAllUsers } from "@/lib/services/userService";
import logger from "@/lib/logger";

export const dynamic = 'force-dynamic';

export async function GET() {
    const startTime = Date.now();

    try {
        logger.info({ msg: 'Fetching all users' });

        const users = await getAllUsers();

        const duration = Date.now() - startTime;
        logger.info({ msg: 'Users fetched successfully', count: users.length, duration });

        return NextResponse.json({ users });
    } catch (err: unknown) {
        const duration = Date.now() - startTime;
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error({ msg: 'Failed to fetch users', error: errorMessage, duration });
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
