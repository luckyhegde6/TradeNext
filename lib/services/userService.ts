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
