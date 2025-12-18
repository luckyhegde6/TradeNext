import Link from "next/link";
import { DataFetcher } from "@/app/components/ui/DataFetcher";
import { CardSkeleton } from "@/app/components/ui/LoadingSpinner";

interface User {
    id: number;
    name: string | null;
    email: string;
    createdAt: Date;
}

// User List Component
function UsersList() {
    return (
        <DataFetcher
            apiCall={async () => {
                const res = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/users?paginate=true&page=1&limit=50`);
                if (!res.ok) throw new Error('Failed to fetch users');
                return res.json();
            }}
            cacheKey="users:list"
            cacheTTL={300000} // 5 minutes
            loadingComponent={CardSkeleton}
        >
            {(data: { users: User[]; total: number; totalPages: number }) => {
                if (data.users.length === 0) {
                    return <p className="text-gray-600 text-center py-8">No users found.</p>;
                }

                return (
                    <div className="space-y-4">
                        <div className="flex justify-between items-center mb-6">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                Showing {data.users.length} of {data.total} users
                            </p>
                        </div>
                        <ul className="space-y-4">
                            {data.users.map((user: User) => (
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
                                            <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
                                                Joined {new Date(user.createdAt).toLocaleDateString()}
                                            </p>
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                );
            }}
        </DataFetcher>
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

                <UsersList />
            </div>
        </div>
    );
}
