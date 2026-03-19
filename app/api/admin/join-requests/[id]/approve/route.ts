import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { updateJoinRequestStatus } from "@/lib/services/userService";
import bcrypt from "bcryptjs";
import crypto from "crypto";
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
        // Generate a temporary password
        const tempPassword = crypto.randomBytes(8).toString('hex');
        const hashedPassword = await bcrypt.hash(tempPassword, 12);

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

        logger.info({ msg: "Join request approved", email: joinRequest.email, userId: user.id });

        // In a real app, send email with tempPassword here
        console.log(`[EMAIL MOCK] Welcome to TradeNext! Your temporary password is: ${tempPassword}`);

        return NextResponse.json({ success: true, userId: user.id });
    } catch (error) {
        logger.error({ msg: "Approval failed", error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: "Failed to approve request" }, { status: 500 });
    }
}
