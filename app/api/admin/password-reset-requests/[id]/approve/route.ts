import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import logger from "@/lib/logger";
import {
  getPasswordResetRequestById,
  updatePasswordResetRequestStatus,
} from "@/lib/services/userService";
import { invalidateUserTokens } from "@/lib/services/sessionService";
import { createAuditLog } from "@/lib/audit";
import { notifyUser, notifyAdmins } from "@/lib/services/notificationService";

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

    const email = resetRequest.email.toLowerCase();

    // The user must exist — a reset for a missing account is invalid.
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      await updatePasswordResetRequestStatus(id, 'rejected');
      logger.warn({ msg: "Password reset request rejected: user not found", email, requestId: id });
      return NextResponse.json(
        { error: "No account exists for this email — request rejected." },
        { status: 400 }
      );
    }

    // Default password comes from the DEFAULT_PASSWORD env var (server-only,
    // never hardcoded). The value is returned to the admin so they can share
    // it with the requester.
    const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD ?? "";
    if (!DEFAULT_PASSWORD) {
      logger.error({ msg: "DEFAULT_PASSWORD env not set — cannot approve password reset" });
      return NextResponse.json(
        { error: "Server not configured: DEFAULT_PASSWORD missing" },
        { status: 500 }
      );
    }
    const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 12);

    // Set the new password and force all existing sessions to re-authenticate.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        isVerified: true,
      },
    });
    await invalidateUserTokens(user.id);

    await updatePasswordResetRequestStatus(id, 'approved');

    await notifyUser(
      user.id,
      "Password Reset Approved",
      "Your password reset request was approved. Contact your administrator to receive your new temporary password and sign back in.",
      "/auth/signin"
    );
    // NO secrets in the notification body — the temp password only goes to the
    // admin through the API response below (shared out-of-band with the user).
    await notifyAdmins(
      "Password Reset Approved",
      `Password reset for ${email} was approved by ${session.user.email}.`,
      "/admin/users?tab=password-resets"
    );

    await createAuditLog({
      userId: user.id,
      userEmail: email,
      action: "PASSWORD_RESET_APPROVED",
      resource: "User",
      resourceId: user.id.toString(),
      metadata: { requestId: id, approvedBy: session.user.email },
    });

    logger.info({ msg: "Password reset approved", email, userId: user.id });

    // The temp password is shown ONLY to the admin (the approval actor), who
    // shares it with the requester out-of-band.
    return NextResponse.json({
      success: true,
      userId: user.id,
      email,
      defaultPassword: DEFAULT_PASSWORD,
      message: "Password reset approved. Share the default password with the requester (or instruct them to set a new one).",
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ msg: "Password reset approval failed", error: errorMessage });
    return NextResponse.json({ error: "Failed to approve request" }, { status: 500 });
  }
}