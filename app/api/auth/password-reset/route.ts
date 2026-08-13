import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { z } from "zod";
import logger from "@/lib/logger";
import {
  createPasswordResetRequest,
  hasPendingPasswordResetRequest,
} from "@/lib/services/userService";
import { createAuditLog } from "@/lib/audit";
import { notifyAdmins } from "@/lib/services/notificationService";

export const runtime = "nodejs";

const passwordResetRequestSchema = z.object({
  email: z.string().email("Invalid email address"),
  reason: z.string().max(500).optional(),
});

// Public: a user with an existing account requests a password reset.
// The request goes to admins for approval — the requester never chooses
// their own password (approval sets the DEFAULT_PASSWORD env value).
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const validatedData = passwordResetRequestSchema.parse(body);
    const email = validatedData.email.toLowerCase();

    // Existing accounts only — no enumeration gameplay: we do NOT reveal
    // whether the email exists, but we only create a request for real users.
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });

    if (!existingUser) {
      logger.warn({ msg: "Password reset requested for unknown email", email });
      // Return success to avoid account enumeration; nothing is created.
      return NextResponse.json({
        success: true,
        message:
          "If an account exists for this email, a password reset request has been submitted for admin approval.",
      });
    }

    // Dedup: only one pending request per email at a time.
    if (await hasPendingPasswordResetRequest(email)) {
      return NextResponse.json({
        success: true,
        message:
          "A password reset request for this email is already pending admin approval.",
      });
    }

    await createPasswordResetRequest({
      email,
      reason: validatedData.reason,
    });

    await notifyAdmins(
      "Password Reset Request",
      `${existingUser.email} requested a password reset. Approve or reject it in Admin → User Management → Password Resets.`,
      "/admin/users?tab=password-resets"
    );

    await createAuditLog({
      userEmail: email,
      action: "PASSWORD_RESET_REQUESTED",
      resource: "User",
      resourceId: existingUser.id.toString(),
    });

    logger.info({ msg: "Password reset request created", email });

    return NextResponse.json({
      success: true,
      message:
        "Your password reset request has been submitted. An administrator will review it shortly.",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ msg: "Password reset request failed", error: errorMessage });
    return NextResponse.json({ error: "Failed to submit request" }, { status: 500 });
  }
}