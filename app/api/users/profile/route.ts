import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function PUT(req: Request) {
    try {
        const session = await auth();

        if (!session?.user?.email) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { name, mobile, password } = await req.json();

        const updateData: any = {};
        if (name !== undefined) updateData.name = name;
        if (mobile !== undefined) updateData.mobile = mobile;
        if (password) {
            updateData.password = await bcrypt.hash(password, 12);
        }

        const user = await prisma.user.update({
            where: { email: session.user.email },
            data: updateData,
            select: {
                id: true,
                name: true,
                email: true,
                mobile: true,
                role: true
            }
        });

        return NextResponse.json(user);
    } catch (error) {
        console.error('Profile update error:', error);
        return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
    }
}
