import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { updateJoinRequestStatus } from "@/lib/services/userService";
import { createAuditLog } from "@/lib/audit";
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

        const joinRequest = await prisma.joinRequest.findUnique({
            where: { id },
            select: { id: true, email: true },
        });

        await updateJoinRequestStatus(id, 'rejected');

        await createAuditLog({
            userEmail: joinRequest?.email,
            action: 'JOIN_REQUEST_REJECTED',
            resource: 'JoinRequest',
            resourceId: id,
            metadata: { rejectedBy: session.user.email },
        });

        // Rejection does not create an account, so there is no user to notify
        // directly — log it for the admin trail only.

        logger.info({ msg: "Join request rejected", id });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error({ msg: "Rejection failed", error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: "Failed to reject request" }, { status: 500 });
    }
}
