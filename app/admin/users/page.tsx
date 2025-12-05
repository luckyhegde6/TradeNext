export const dynamic = "force-dynamic";

import Link from "next/link";
import { Suspense } from "react";

interface User {
    id: number;
    name: string | null;
    email: string;
    role: string; // Assuming role is a string
    createdAt: Date;
}

// Admin User List Component
async function AdminUsersList() {
    const { default: prisma } = await import("@/lib/prisma");

    const users = await prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            createdAt: true,
        },
    });

    if (users.length === 0) {
        return <p className="text-gray-600">No users found.</p>;
    }

    return (
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
            <ul className="divide-y divide-gray-200">
                {users.map((user: User) => (
                    <li key={user.id}>
                        <div className="px-4 py-4 sm:px-6">
                            <div className="flex items-center justify-between">
                                <div className="flex flex-col">
                                    <p className="text-sm font-medium text-blue-600 truncate">{user.name || "No Name"}</p>
                                    <p className="text-sm text-gray-500">{user.email}</p>
                                </div>
                                <div className="flex items-center space-x-4">
                                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${user.role === 'admin' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                                        {user.role}
                                    </span>
                                    <Link href={`/admin/users/${user.id}`}>
                                        <button className="text-indigo-600 hover:text-indigo-900 border border-indigo-600 px-3 py-1 rounded text-sm">Edit</button>
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default function AdminUsersPage() {
    return (
        <div className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-3xl font-bold text-gray-900 mb-8">Admin Dashboard: Users</h1>
                <Suspense fallback={<p>Loading users...</p>}>
                    <AdminUsersList />
                </Suspense>
            </div>
        </div>
    );
}
