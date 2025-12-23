import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hash } from "bcryptjs";
import crypto from "crypto";

export async function POST(req: Request) {
    try {
        const { name, email, password } = await req.json();

        if (!email || !password) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        const existingUser = await prisma.user.findUnique({
            where: { email }
        });

        if (existingUser) {
            return NextResponse.json({
                error: "User already exists. If you haven't verified your email, please try signing in to get a verification link."
            }, { status: 400 });
        }

        const hashedPassword = await hash(password, 12);
        const verificationCode = crypto.randomInt(100000, 999999).toString();
        const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        const user = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
                verificationCode,
                verificationExpiry,
                isVerified: false
            }
        });

        // Mock Email Sending
        console.log(`[EMAIL MOCK] Verification code for ${email}: ${verificationCode}`);

        return NextResponse.json({ success: true, email: user.email });
    } catch (error) {
        console.error('Signup error:', error);
        return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }
}
