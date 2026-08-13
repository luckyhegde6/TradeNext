import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { updateJoinRequestStatus } from "@/lib/services/userService";
import { createAuditLog } from "@/lib/audit";
import { notifyUser } from "@/lib/services/notificationService";
import bcrypt from "bcryptjs";
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

        // Fetch the request
        const joinRequest = await prisma.joinRequest.findUnique({
            where: { id }
        });

        if (!joinRequest) {
            return NextResponse.json({ error: "Request not found" }, { status: 404 });
        }

        if (joinRequest.status !== 'pending') {
            return NextResponse.json({ error: "Request already processed" }, { status: 400 });
        }

        // 1. Create the User
        // Default password comes from the DEFAULT_PASSWORD env var (server-only,
        // never hardcoded in the repo). The value is returned in the response so
        // the admin UI can share it with the applicant.
        const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD ?? "";
        if (!DEFAULT_PASSWORD) {
            logger.error({ msg: "DEFAULT_PASSWORD env not set — cannot approve join request" });
            return NextResponse.json({ error: "Server not configured: DEFAULT_PASSWORD missing" }, { status: 500 });
        }
        const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 12);

        const user = await prisma.user.create({
            data: {
                name: joinRequest.name,
                email: joinRequest.email,
                mobile: joinRequest.mobile,
                password: hashedPassword,
                role: 'user',
                isVerified: true // Approved users are verified
            }
        });

        // 2. Update status
        await updateJoinRequestStatus(id, 'approved');

        // 3. Notify the new user (in-app + Telegram best-effort if linked).
        //    NO password in the message — the temp password goes to the admin
        //    through the API response (shared out-of-band).
        await notifyUser(
            user.id,
            "Welcome to TradeNext!",
            `Your access request was approved, ${joinRequest.name}. Contact your administrator to receive your temporary password and sign in.`,
            "/auth/signin"
        );

        await createAuditLog({
            userId: user.id,
            userEmail: joinRequest.email,
            action: 'JOIN_REQUEST_APPROVED',
            resource: 'JoinRequest',
            resourceId: id,
            metadata: { approvedBy: session.user.email },
        });

        logger.info({ msg: "Join request approved", email: joinRequest.email, userId: user.id });

        // In a real app, send email with the default password here
        console.log(`[EMAIL MOCK] Welcome to TradeNext! Your default password is: ${DEFAULT_PASSWORD}`);

        return NextResponse.json({ success: true, userId: user.id, defaultPassword: DEFAULT_PASSWORD, email: joinRequest.email });
    } catch (error) {
        logger.error({ msg: "Approval failed", error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: "Failed to approve request" }, { status: 500 });
    }
}
