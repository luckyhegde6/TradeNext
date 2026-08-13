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

export interface JoinRequest {
    id: string;
    name: string;
    email: string;
    mobile?: string | null;
    message?: string | null;
    status: string;
    createdAt: Date;
}

export async function createJoinRequest(data: { name: string; email: string; mobile?: string; message?: string }) {
    return await prisma.joinRequest.create({
        data
    });
}

export async function getPendingJoinRequests(): Promise<JoinRequest[]> {
    return await prisma.joinRequest.findMany({
        where: { status: 'pending' },
        orderBy: { createdAt: 'desc' }
    });
}

export async function updateJoinRequestStatus(id: string, status: 'approved' | 'rejected') {
    return await prisma.joinRequest.update({
        where: { id },
        data: { status }
    });
}

export interface PasswordResetRequest {
    id: string;
    email: string;
    reason?: string | null;
    status: string;
    createdAt: Date;
}

export async function hasPendingPasswordResetRequest(email: string): Promise<boolean> {
    const existing = await prisma.passwordResetRequest.findFirst({
        where: { email, status: 'pending' },
        select: { id: true }
    });
    return existing !== null;
}

export async function createPasswordResetRequest(data: { email: string; reason?: string }) {
    return await prisma.passwordResetRequest.create({
        data
    });
}

export async function getPendingPasswordResetRequests(): Promise<PasswordResetRequest[]> {
    return await prisma.passwordResetRequest.findMany({
        where: { status: 'pending' },
        orderBy: { createdAt: 'desc' }
    });
}

export async function getPasswordResetRequestById(id: string) {
    return await prisma.passwordResetRequest.findUnique({
        where: { id }
    });
}

export async function updatePasswordResetRequestStatus(id: string, status: 'approved' | 'rejected') {
    return await prisma.passwordResetRequest.update({
        where: { id },
        data: { status }
    });
}
