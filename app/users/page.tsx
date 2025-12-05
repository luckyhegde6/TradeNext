export const dynamic = "force-dynamic";

import Link from "next/link";
import { Suspense } from "react";

interface User {
    id: number;
    name: string | null;
    email: string;
    createdAt: Date;
}

// User List Component
async function UsersList() {
    // Lazy-load Prisma
    const { default: prisma } = await import("@/lib/prisma");

    const users = await prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            name: true,
            email: true,
            createdAt: true,
        },
    });

    if (users.length === 0) {
        return <p className="text-gray-600 text-center py-8">No users found.</p>;
    }

    return (
        <ul className="space-y-4">
            {users.map((user: User) => (
                <li key={user.id} className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg p-6 shadow-sm hover:shadow-md transition-all">
                    <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-xl">
                            {user.name?.[0] || user.email[0].toUpperCase()}
                        </div>
                        <div>
                            <p className="text-lg font-semibold text-gray-900 dark:text-white">
                                {user.name || "Unnamed User"}
                            </p>
                            <p className="text-sm text-gray-500 dark:text-slate-400">
                                {user.email}
                            </p>
                        </div>
                    </div>
                </li>
            ))}
        </ul>
    );
}

export default function UsersPage() {
    return (
        <div className="min-h-screen bg-gray-50 dark:bg-slate-950 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-4xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Users</h1>
                    <Link
                        href="/users/new"
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                    >
                        Create User
                    </Link>
                </div>

                <Suspense
                    fallback={
                        <div className="flex items-center justify-center min-h-[200px]">
                            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                            <p className="ml-3 text-gray-600 dark:text-slate-400">Loading users...</p>
                        </div>
                    }
                >
                    <UsersList />
                </Suspense>
            </div>
        </div>
    );
}
