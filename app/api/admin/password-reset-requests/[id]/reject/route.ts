import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import {
  getPasswordResetRequestById,
  updatePasswordResetRequestStatus,
} from "@/lib/services/userService";
import { createAuditLog } from "@/lib/audit";
import { notifyUser } from "@/lib/services/notificationService";

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

    const resetRequest = await getPasswordResetRequestById(id);
    if (!resetRequest) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }
    if (resetRequest.status !== 'pending') {
      return NextResponse.json({ error: "Request already processed" }, { status: 400 });
    }

    await updatePasswordResetRequestStatus(id, 'rejected');

    const email = resetRequest.email.toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    // Best-effort: notify the account owner if they still exist.
    if (user) {
      await notifyUser(
        user.id,
        "Password Reset Rejected",
        "Your password reset request was rejected by an administrator. If you believe this is an error, contact support.",
        "/auth/signin"
      );
    }

    await createAuditLog({
      userId: user?.id,
      userEmail: email,
      action: "PASSWORD_RESET_REJECTED",
      resource: "User",
      resourceId: user?.id?.toString(),
      metadata: { requestId: id, rejectedBy: session.user.email },
    });

    logger.info({ msg: "Password reset request rejected", email, requestId: id });

    return NextResponse.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ msg: "Password reset rejection failed", error: errorMessage });
    return NextResponse.json({ error: "Failed to reject request" }, { status: 500 });
  }
}