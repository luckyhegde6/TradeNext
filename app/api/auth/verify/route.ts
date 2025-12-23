import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(req: Request) {
    try {
        const { email, code } = await req.json();

        if (!email || !code) {
            return NextResponse.json({ error: "Email and code are required" }, { status: 400 });
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

        if (user.verificationCode !== code) {
            return NextResponse.json({ error: "Invalid verification code" }, { status: 400 });
        }

        if (user.verificationExpiry && new Date() > user.verificationExpiry) {
            return NextResponse.json({ error: "Verification code expired" }, { status: 400 });
        }

        await prisma.user.update({
            where: { email },
            data: {
                isVerified: true,
                verificationCode: null,
                verificationExpiry: null,
            },
        });

        return NextResponse.json({ message: "Email verified successfully" });
    } catch (error) {
        console.error("Verification Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
