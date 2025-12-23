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
            <div className="space-y-6">
                <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
                <div className="animate-pulse space-y-4">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="bg-gray-200 h-16 rounded-lg"></div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
                <button
                    onClick={() => setShowCreateForm(!showCreateForm)}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                    {showCreateForm ? 'Cancel' : 'Create User'}
                </button>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <p className="text-red-800">{error}</p>
                    <button
                        onClick={() => setError(null)}
                        className="mt-2 text-red-600 hover:text-red-800 text-sm"
                    >
                        Dismiss
                    </button>
                </div>
            )}

            {/* Create User Form */}
            {showCreateForm && (
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Create New User</h2>
                    <form onSubmit={handleCreateUser} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                                <input
                                    type="text"
                                    value={createForm.name}
                                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                                <input
                                    type="email"
                                    value={createForm.email}
                                    onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                                <input
                                    type="password"
                                    value={createForm.password}
                                    onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    required
                                    minLength={6}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                                <select
                                    value={createForm.role}
                                    onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as 'user' | 'admin' })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="user">User</option>
                                    <option value="admin">Admin</option>
                                </select>
                            </div>
                        </div>
                        <div className="flex space-x-3">
                            <button
                                type="submit"
                                disabled={creating}
                                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                            >
                                {creating ? 'Creating...' : 'Create User'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowCreateForm(false)}
                                className="bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Users List */}
            <div className="bg-white shadow overflow-hidden sm:rounded-md">
                <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
                    <h3 className="text-lg leading-6 font-medium text-gray-900">
                        Users ({users.length})
                    </h3>
                </div>
                <ul className="divide-y divide-gray-200">
                    {users.map((user) => (
                        <li key={user.id}>
                            <div className="px-4 py-4 sm:px-6">
                                <div className="flex items-center justify-between">
                                    <div className="flex flex-col flex-1">
                                        <div className="flex items-center space-x-3">
                                            <p className="text-sm font-medium text-blue-600">{user.name || "No Name"}</p>
                                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${user.role === 'admin' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
                                                }`}>
                                                {user.role}
                                            </span>
                                            {user.isBlocked && (
                                                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">
                                                    Blocked
                                                </span>
                                            )}
                                            {!user.isVerified && (
                                                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">
                                                    Unverified
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-sm text-gray-500">{user.email}</p>
                                        <div className="flex items-center space-x-4 mt-1 text-xs text-gray-400">
                                            <span>{user._count.portfolios} portfolios</span>
                                            <span>{user._count.posts} posts</span>
                                            <span>Joined {new Date(user.createdAt).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center space-x-3">
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
                                            className={`px-3 py-1 rounded text-sm border transition-colors ${user.isBlocked
                                                ? 'text-green-600 border-green-600 hover:bg-green-50'
                                                : 'text-orange-600 border-orange-600 hover:bg-orange-50'
                                                }`}
                                        >
                                            {user.isBlocked ? 'Unblock' : 'Block'}
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
                                            className="text-gray-600 hover:text-gray-900 border border-gray-600 px-3 py-1 rounded text-sm transition-colors"
                                        >
                                            Reset PW
                                        </button>
                                        <Link href={`/admin/users/${user.id}`}>
                                            <button className="text-indigo-600 hover:text-indigo-900 border border-indigo-600 px-3 py-1 rounded text-sm transition-colors">
                                                View
                                            </button>
                                        </Link>
                                        <button
                                            onClick={() => handleDeleteUser(user.id, user.email)}
                                            className="text-red-600 hover:text-red-900 border border-red-600 px-3 py-1 rounded text-sm transition-colors"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
                {users.length === 0 && (
                    <div className="px-4 py-8 text-center">
                        <p className="text-gray-500">No users found.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
