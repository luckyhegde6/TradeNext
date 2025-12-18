import prisma from "@/lib/prisma";

export interface User {
    id: number;
    name: string | null;
    email: string;
    createdAt: Date;
}

export async function getAllUsers(): Promise<User[]> {
    return await prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            name: true,
            email: true,
            createdAt: true,
        },
    });
}

export async function getPaginatedUsers(page: number = 1, limit: number = 20): Promise<{ users: User[]; total: number; totalPages: number }> {
    const offset = (page - 1) * limit;

    const [users, total] = await Promise.all([
        prisma.user.findMany({
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                name: true,
                email: true,
                createdAt: true,
            },
            skip: offset,
            take: limit,
        }),
        prisma.user.count()
    ]);

    const totalPages = Math.ceil(total / limit);

    return { users, total, totalPages };
}

export async function getUserById(id: number): Promise<User | null> {
    return await prisma.user.findUnique({
        where: { id },
        select: {
            id: true,
            name: true,
            email: true,
            createdAt: true,
        },
    });
}

export async function createUser(data: { name?: string; email: string; password?: string }): Promise<User> {
    return await prisma.user.create({
        data: {
            name: data.name,
            email: data.email,
            password: data.password,
        },
        select: {
            id: true,
            name: true,
            email: true,
            createdAt: true,
        },
    });
}
