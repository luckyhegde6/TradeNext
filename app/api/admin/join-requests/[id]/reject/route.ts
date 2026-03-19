import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { updateJoinRequestStatus } from "@/lib/services/userService";
import logger from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();

        if (!session || !session.user || session.user.role !== 'admin') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;

        await updateJoinRequestStatus(id, 'rejected');

        logger.info({ msg: "Join request rejected", id });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error({ msg: "Rejection failed", error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: "Failed to reject request" }, { status: 500 });
    }
}
