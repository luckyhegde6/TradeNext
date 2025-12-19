"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface User {
    id: number;
    name: string | null;
    email: string;
    role: string;
    createdAt: string;
    updatedAt: string;
    portfolios: Array<{
        id: number;
        name: string;
        holdings: Array<{
            id: number;
            symbol: string;
            quantity: number;
            averagePrice: number;
            stock: {
                symbol: string;
                name: string | null;
                sector: string | null;
            };
        }>;
    }>;
    posts: Array<{
        id: number;
        title: string;
        createdAt: string;
    }>;
    _count: {
        portfolios: number;
        posts: number;
    };
}

interface PortfolioData {
    user: {
        id: number;
        name: string | null;
        email: string;
    };
    portfolios: Array<{
        id: number;
        name: string;
        holdings: Array<any>;
        stats: {
            totalValue: number;
            totalStocks: number;
            sectors: number;
            sectorList: string[];
        };
    }>;
}

export default function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const [user, setUser] = useState<User | null>(null);
    const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editForm, setEditForm] = useState({
        name: '',
        email: '',
        role: 'user' as 'user' | 'admin',
        password: ''
    });
    const router = useRouter();

    const fetchUserData = async () => {
        try {
            const resolvedParams = await params;
            const userId = resolvedParams.id;

            const [userRes, portfolioRes] = await Promise.all([
                fetch(`/api/admin/users/${userId}`),
                fetch(`/api/admin/users/${userId}/portfolio`)
            ]);

            if (!userRes.ok || !portfolioRes.ok) {
                throw new Error('Failed to fetch user data');
            }

            const userData = await userRes.json();
            const portfolioData = await portfolioRes.json();

            setUser(userData);
            setPortfolioData(portfolioData);
            setEditForm({
                name: userData.name || '',
                email: userData.email,
                role: userData.role,
                password: ''
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUserData();
    }, []);

    const handleUpdateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setUpdating(true);

        try {
            const resolvedParams = await params;
            const response = await fetch(`/api/admin/users/${resolvedParams.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: editForm.name,
                    email: editForm.email,
                    role: editForm.role,
                    ...(editForm.password && { password: editForm.password })
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to update user');
            }

            fetchUserData(); // Refresh data
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setUpdating(false);
        }
    };

    if (loading) {
        return (
            <div className="space-y-6">
                <div className="flex items-center space-x-4">
                    <button
                        onClick={() => router.back()}
                        className="text-gray-600 hover:text-gray-800"
                    >
                        ← Back to Users
                    </button>
                </div>
                <div className="animate-pulse space-y-4">
                    <div className="bg-gray-200 h-8 rounded w-1/3"></div>
                    <div className="bg-gray-200 h-64 rounded"></div>
                </div>
            </div>
        );
    }

    if (error || !user) {
        return (
            <div className="space-y-6">
                <div className="flex items-center space-x-4">
                    <button
                        onClick={() => router.back()}
                        className="text-gray-600 hover:text-gray-800"
                    >
                        ← Back to Users
                    </button>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <p className="text-red-800">{error || 'User not found'}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                    <button
                        onClick={() => router.back()}
                        className="text-gray-600 hover:text-gray-800"
                    >
                        ← Back to Users
                    </button>
                    <h1 className="text-3xl font-bold text-gray-900">User Details: {user.name}</h1>
                </div>
                <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                    user.role === 'admin' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
                }`}>
                    {user.role}
                </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* User Info & Edit Form */}
                <div className="lg:col-span-1">
                    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4">User Information</h2>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Name</label>
                                <p className="text-gray-900">{user.name || 'No name set'}</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Email</label>
                                <p className="text-gray-900">{user.email}</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Role</label>
                                <p className="text-gray-900 capitalize">{user.role}</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Joined</label>
                                <p className="text-gray-900">{new Date(user.createdAt).toLocaleDateString()}</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Last Updated</label>
                                <p className="text-gray-900">{new Date(user.updatedAt).toLocaleDateString()}</p>
                            </div>
                        </div>

                        <div className="mt-6 pt-4 border-t border-gray-200">
                            <h3 className="text-md font-semibold text-gray-900 mb-2">Activity Summary</h3>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Portfolios:</span>
                                    <span className="font-semibold">{user._count.portfolios}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Posts:</span>
                                    <span className="font-semibold">{user._count.posts}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Edit Form */}
                    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 mt-6">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4">Edit User</h2>
                        <form onSubmit={handleUpdateUser} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                                <input
                                    type="text"
                                    value={editForm.name}
                                    onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                                <input
                                    type="email"
                                    value={editForm.email}
                                    onChange={(e) => setEditForm({...editForm, email: e.target.value})}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                                <select
                                    value={editForm.role}
                                    onChange={(e) => setEditForm({...editForm, role: e.target.value as 'user' | 'admin'})}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="user">User</option>
                                    <option value="admin">Admin</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">New Password (optional)</label>
                                <input
                                    type="password"
                                    value={editForm.password}
                                    onChange={(e) => setEditForm({...editForm, password: e.target.value})}
                                    placeholder="Leave empty to keep current password"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={updating}
                                className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                            >
                                {updating ? 'Updating...' : 'Update User'}
                            </button>
                        </form>
                    </div>
                </div>

                {/* Portfolio Overview */}
                <div className="lg:col-span-2">
                    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4">Portfolio Overview (Delegated Access)</h2>

                        {portfolioData && portfolioData.portfolios.length > 0 ? (
                            <div className="space-y-6">
                                {portfolioData.portfolios.map((portfolio) => (
                                    <div key={portfolio.id} className="border border-gray-200 rounded-lg p-4">
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <h3 className="text-lg font-semibold text-gray-900">{portfolio.name}</h3>
                                                <p className="text-sm text-gray-600">
                                                    {portfolio.stats.totalStocks} stocks • {portfolio.stats.sectors} sectors
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-lg font-bold text-green-600">
                                                    ₹{portfolio.stats.totalValue.toLocaleString('en-IN')}
                                                </p>
                                                <p className="text-xs text-gray-500">Total Value</p>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <h4 className="font-medium text-gray-900">Holdings:</h4>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                {portfolio.holdings.slice(0, 6).map((holding) => (
                                                    <div key={holding.id} className="flex justify-between items-center py-2 px-3 bg-gray-50 rounded">
                                                        <div>
                                                            <p className="font-medium text-gray-900">{holding.symbol}</p>
                                                            <p className="text-xs text-gray-600">{holding.stock.name}</p>
                                                        </div>
                                                        <div className="text-right">
                                                            <p className="text-sm font-semibold">{holding.quantity}</p>
                                                            <p className="text-xs text-gray-500">₹{holding.averagePrice.toFixed(2)}</p>
                                                        </div>
                                                    </div>
                                                ))}
                                                {portfolio.holdings.length > 6 && (
                                                    <div className="py-2 px-3 text-center text-gray-500 text-sm">
                                                        +{portfolio.holdings.length - 6} more holdings
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {portfolio.stats.sectorList.length > 0 && (
                                            <div className="mt-4 pt-3 border-t border-gray-200">
                                                <h4 className="font-medium text-gray-900 mb-2">Sectors:</h4>
                                                <div className="flex flex-wrap gap-1">
                                                    {portfolio.stats.sectorList.map((sector, index) => (
                                                        <span key={index} className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                                                            {sector}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-8">
                                <p className="text-gray-500">No portfolios found for this user.</p>
                            </div>
                        )}
                    </div>

                    {/* Recent Posts */}
                    {user.posts.length > 0 && (
                        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 mt-6">
                            <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Posts</h2>
                            <div className="space-y-3">
                                {user.posts.map((post) => (
                                    <div key={post.id} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                                        <div>
                                            <p className="font-medium text-gray-900">{post.title}</p>
                                            <p className="text-sm text-gray-500">
                                                {new Date(post.createdAt).toLocaleDateString()}
                                            </p>
                                        </div>
                                        <Link
                                            href={`/posts/${post.id}`}
                                            className="text-blue-600 hover:text-blue-800 text-sm"
                                        >
                                            View →
                                        </Link>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
