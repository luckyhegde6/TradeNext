import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

export const runtime = "nodejs";

const createUserSchema = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(6),
    role: z.enum(['user', 'admin']).default('user')
});

const updateUserSchema = z.object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    role: z.enum(['user', 'admin']).optional(),
    password: z.string().min(6).optional()
});

// GET - List all users
export async function GET() {
    try {
        const session = await auth();

        if (!session || !session.user || session.user.role !== 'admin') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const users = await prisma.user.findMany({
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                createdAt: true,
                updatedAt: true,
                _count: {
                    select: {
                        portfolios: true,
                        posts: true
                    }
                }
            }
        });

        return NextResponse.json(users);
    } catch (error) {
        console.error('Admin users GET error:', error);
        return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
    }
}

// POST - Create new user
export async function POST(req: Request) {
    try {
        const session = await auth();

        if (!session || !session.user || session.user.role !== 'admin') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const validatedData = createUserSchema.parse(body);

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email: validatedData.email }
        });

        if (existingUser) {
            return NextResponse.json({ error: "User with this email already exists" }, { status: 400 });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(validatedData.password, 12);

        const user = await prisma.user.create({
            data: {
                name: validatedData.name,
                email: validatedData.email,
                password: hashedPassword,
                role: validatedData.role
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                createdAt: true
            }
        });

        return NextResponse.json(user, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: "Invalid input", details: error.issues }, { status: 400 });
        }
        console.error('Admin users POST error:', error);
        return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }
}
