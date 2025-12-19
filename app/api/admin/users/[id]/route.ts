import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

export const runtime = "nodejs";

const updateUserSchema = z.object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    role: z.enum(['user', 'admin']).optional(),
    password: z.string().min(6).optional()
});

// GET - Get specific user details
export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();

        if (!session || session.user.role !== 'admin') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const userId = parseInt(id);

        if (isNaN(userId)) {
            return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                createdAt: true,
                updatedAt: true,
                portfolios: {
                    include: {
                        holdings: {
                            include: {
                                stock: true
                            }
                        }
                    }
                },
                posts: {
                    select: {
                        id: true,
                        title: true,
                        createdAt: true
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 5
                },
                _count: {
                    select: {
                        portfolios: true,
                        posts: true
                    }
                }
            }
        });

        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        return NextResponse.json(user);
    } catch (error) {
        console.error('Admin user GET error:', error);
        return NextResponse.json({ error: "Failed to fetch user" }, { status: 500 });
    }
}

// PUT - Update specific user
export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();

        if (!session || session.user.role !== 'admin') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const userId = parseInt(id);

        if (isNaN(userId)) {
            return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
        }

        const body = await req.json();
        const validatedData = updateUserSchema.parse(body);

        // Prepare update data
        const updateData: any = {};
        if (validatedData.name) updateData.name = validatedData.name;
        if (validatedData.email) updateData.email = validatedData.email;
        if (validatedData.role) updateData.role = validatedData.role;
        if (validatedData.password) {
            updateData.password = await bcrypt.hash(validatedData.password, 12);
        }

        const user = await prisma.user.update({
            where: { id: userId },
            data: updateData,
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                updatedAt: true
            }
        });

        return NextResponse.json(user);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: "Invalid input", details: error.errors }, { status: 400 });
        }
        if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }
        console.error('Admin user PUT error:', error);
        return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
    }
}

// DELETE - Delete specific user
export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();

        if (!session || session.user.role !== 'admin') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const userId = parseInt(id);

        if (isNaN(userId)) {
            return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
        }

        // Prevent deleting self
        if (session.user.id === userId) {
            return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
        }

        // Check if user exists
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        // Delete user (cascade will handle related data)
        await prisma.user.delete({
            where: { id: userId }
        });

        return NextResponse.json({ message: "User deleted successfully" });
    } catch (error) {
        console.error('Admin user DELETE error:', error);
        return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
    }
}
