import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import crypto from "crypto";

export async function POST(req: Request) {
    try {
        const { email } = await req.json();

        if (!email) {
            return NextResponse.json({ error: "Email is required" }, { status: 400 });
        }

        const user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        if (user.isVerified) {
            return NextResponse.json({ error: "Email already verified" }, { status: 400 });
        }

        if (user.verificationResendCount >= 3) {
            return NextResponse.json({ error: "Maximum resend limit reached (3). Please contact support." }, { status: 400 });
        }

        // Generate new code
        const verificationCode = crypto.randomInt(100000, 999999).toString();
        const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        await prisma.user.update({
            where: { email },
            data: {
                verificationCode,
                verificationExpiry,
                verificationResendCount: { increment: 1 },
            },
        });

        // Mock Email Sending
        console.log(`[EMAIL MOCK] New verification code for ${email}: ${verificationCode}`);
        console.log(`[EMAIL MOCK] New verification link: http://localhost:3000/auth/verify?email=${encodeURIComponent(email)}&code=${verificationCode}`);

        return NextResponse.json({ message: "Verification code resent" });
    } catch (error) {
        console.error("Resend Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
