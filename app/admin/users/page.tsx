"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface User {
    id: number;
    name: string | null;
    email: string;
    role: string;
    isVerified: boolean;
    isBlocked: boolean;
    createdAt: string;
    updatedAt: string;
    _count: {
        portfolios: number;
        posts: number;
    };
}

interface CreateUserData {
    name: string;
    email: string;
    password: string;
    role: 'user' | 'admin';
}

export default function AdminUsersPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [createForm, setCreateForm] = useState<CreateUserData>({
        name: '',
        email: '',
        password: '',
        role: 'user'
    });
    const [creating, setCreating] = useState(false);

    const fetchUsers = async () => {
        try {
            const response = await fetch('/api/admin/users');
            if (!response.ok) throw new Error('Failed to fetch users');
            const data = await response.json();
            setUsers(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreating(true);

        try {
            const response = await fetch('/api/admin/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(createForm)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to create user');
            }

            setCreateForm({ name: '', email: '', password: '', role: 'user' });
            setShowCreateForm(false);
            fetchUsers(); // Refresh the list
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setCreating(false);
        }
    };

    const handleDeleteUser = async (userId: number, userEmail: string) => {
        if (!confirm(`Are you sure you want to delete user ${userEmail}? This action cannot be undone.`)) {
            return;
        }

        try {
            const response = await fetch(`/api/admin/users/${userId}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to delete user');
            }

            fetchUsers(); // Refresh the list
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        }
    };

    if (loading) {
        return (
            <div className="space-y-6 animate-in fade-in duration-500">
                <div className="flex justify-between items-center border-b dark:border-slate-800 pb-4">
                    <div className="space-y-1">
                        <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">User Management</h1>
                        <p className="text-sm text-gray-500 dark:text-slate-400">Loading system users...</p>
                    </div>
                </div>
                <div className="animate-pulse space-y-4">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="bg-gray-100 dark:bg-slate-800/50 h-20 rounded-xl border border-gray-200 dark:border-slate-800"></div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex justify-between items-center border-b dark:border-slate-800 pb-4">
                <div className="space-y-1">
                    <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">User Management</h1>
                    <p className="text-sm text-gray-500 dark:text-slate-400">Manage application users, roles, and access control.</p>
                </div>
                <button
                    onClick={() => setShowCreateForm(!showCreateForm)}
                    className={`${showCreateForm ? 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300' : 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                        } px-5 py-2.5 rounded-xl font-bold transition-all active:scale-95`}
                >
                    {showCreateForm ? 'Cancel' : 'Create User'}
                </button>
            </div>

            {error && (
                <div className="bg-red-50 dark:bg-red-901/20 border border-red-200 dark:border-red-800/50 rounded-xl p-4 flex items-center justify-between">
                    <p className="text-red-800 dark:text-red-400 font-medium">{error}</p>
                    <button
                        onClick={() => setError(null)}
                        className="text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 p-1 rounded-lg transition-colors"
                    >
                        Dismiss
                    </button>
                </div>
            )}

            {/* Create User Form */}
            {showCreateForm && (
                <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-gray-100 dark:border-slate-800 animate-in slide-in-from-top-4 duration-300">
                    <div className="mb-6">
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Create New User</h2>
                        <p className="text-sm text-gray-500 dark:text-slate-400">Fill in the details to add a new member to the platform.</p>
                    </div>
                    <form onSubmit={handleCreateUser} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 ml-1">Name</label>
                                <input
                                    type="text"
                                    value={createForm.name}
                                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                                    placeholder="Enter full name"
                                    className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 ml-1">Email Address</label>
                                <input
                                    type="email"
                                    value={createForm.email}
                                    onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                                    placeholder="user@example.com"
                                    className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 ml-1">Password</label>
                                <input
                                    type="password"
                                    value={createForm.password}
                                    onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                                    placeholder="Min. 6 characters"
                                    className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                                    required
                                    minLength={6}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 ml-1">Account Role</label>
                                <select
                                    value={createForm.role}
                                    onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as 'user' | 'admin' })}
                                    className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                                >
                                    <option value="user">Standard User</option>
                                    <option value="admin">Administrator</option>
                                </select>
                            </div>
                        </div>
                        <div className="flex items-center space-x-4 pt-2">
                            <button
                                type="submit"
                                disabled={creating}
                                className="flex-1 md:flex-none md:min-w-[140px] bg-blue-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50 transition-all shadow-lg shadow-blue-500/25 active:scale-95"
                            >
                                {creating ? 'Creating...' : 'Create Account'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowCreateForm(false)}
                                className="px-6 py-3 rounded-xl font-bold text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-all active:scale-95"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Users List */}
            <div className="bg-white dark:bg-slate-900 shadow-xl shadow-slate-200/50 dark:shadow-none border border-gray-100 dark:border-slate-800 overflow-hidden rounded-2xl">
                <div className="px-6 py-5 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/50 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                        Platform Users <span className="ml-2 px-2 py-0.5 bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-slate-400 rounded-full text-xs">{users.length}</span>
                    </h3>
                    <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-slate-400 font-medium">
                        <div className="w-2 h-2 rounded-full bg-green-500"></div>
                        <span>Live System Data</span>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50/50 dark:bg-slate-800/30 text-xs font-bold text-gray-500 dark:text-slate-500 uppercase tracking-widest border-b dark:border-slate-800">
                                <th className="px-6 py-4">User Details</th>
                                <th className="px-6 py-4">Account Status</th>
                                <th className="px-6 py-4">Activity</th>
                                <th className="px-6 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                            {users.map((user) => (
                                <tr key={user.id} className="group hover:bg-gray-50/50 dark:hover:bg-blue-900/10 transition-colors">
                                    <td className="px-6 py-5">
                                        <div className="flex items-center">
                                            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-lg mr-4">
                                                {(user.name || user.email)[0].toUpperCase()}
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-gray-900 dark:text-white">{user.name || "No Name"}</p>
                                                <p className="text-xs text-gray-500 dark:text-slate-400 font-medium">{user.email}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-5">
                                        <div className="flex flex-wrap gap-2">
                                            <span className={`px-2.5 py-1 text-[10px] font-extrabold uppercase leading-none rounded-lg ${user.role === 'admin'
                                                ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                                                : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                                                }`}>
                                                {user.role}
                                            </span>
                                            {user.isBlocked ? (
                                                <span className="px-2.5 py-1 text-[10px] font-extrabold uppercase leading-none rounded-lg bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-800/50">
                                                    Blocked
                                                </span>
                                            ) : (
                                                <span className="px-2.5 py-1 text-[10px] font-extrabold uppercase leading-none rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                                                    Active
                                                </span>
                                            )}
                                            {!user.isVerified && (
                                                <span className="px-2.5 py-1 text-[10px] font-extrabold uppercase leading-none rounded-lg bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">
                                                    Pending
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-5">
                                        <div className="flex flex-col space-y-1.5">
                                            <div className="flex items-center space-x-2 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                                <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">{user._count.portfolios}</span>
                                                <span>Portfolios</span>
                                            </div>
                                            <div className="flex items-center space-x-2 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                                <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">{user._count.posts}</span>
                                                <span>Posts</span>
                                            </div>
                                            <p className="text-[10px] text-gray-400 font-medium">Joined {new Date(user.createdAt).toLocaleDateString()}</p>
                                        </div>
                                    </td>
                                    <td className="px-6 py-5 text-right">
                                        <div className="flex items-center justify-end space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={async () => {
                                                    const newStatus = !user.isBlocked;
                                                    if (!confirm(`Are you sure you want to ${newStatus ? 'block' : 'unblock'} this user?`)) return;
                                                    const res = await fetch(`/api/admin/users/${user.id}`, {
                                                        method: 'PUT',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ isBlocked: newStatus })
                                                    });
                                                    if (res.ok) fetchUsers();
                                                }}
                                                title={user.isBlocked ? 'Unblock User' : 'Block User'}
                                                className={`p-2 rounded-xl border transition-all ${user.isBlocked
                                                    ? 'text-green-600 border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/40'
                                                    : 'text-orange-600 border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/40'
                                                    }`}
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    {user.isBlocked ? (
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    ) : (
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636" />
                                                    )}
                                                </svg>
                                            </button>
                                            <button
                                                onClick={async () => {
                                                    const newPassword = prompt("Enter new password (min 6 chars):");
                                                    if (!newPassword || newPassword.length < 6) return;
                                                    const res = await fetch(`/api/admin/users/${user.id}`, {
                                                        method: 'PUT',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ password: newPassword })
                                                    });
                                                    if (res.ok) alert("Password reset successful");
                                                }}
                                                className="p-2 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-all"
                                                title="Reset Password"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                                </svg>
                                            </button>
                                            <Link href={`/admin/users/${user.id}`}>
                                                <button className="p-2 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-all" title="View Profile">
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                    </svg>
                                                </button>
                                            </Link>
                                            <button
                                                onClick={() => handleDeleteUser(user.id, user.email)}
                                                className="p-2 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-all"
                                                title="Delete User"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {users.length === 0 && (
                    <div className="px-6 py-20 text-center bg-gray-50/50 dark:bg-slate-900/50">
                        <div className="w-16 h-16 bg-gray-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg className="w-8 h-8 text-gray-400 dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                            </svg>
                        </div>
                        <p className="text-gray-500 dark:text-slate-500 font-bold">No Users Found</p>
                        <p className="text-sm text-gray-400 dark:text-slate-600 mt-1">Start by creating a new account manually or through signups.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
