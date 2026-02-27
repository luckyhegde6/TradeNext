"use client";

import { useState, useEffect } from "react";

interface Transaction {
  id: string;
  portfolioId: string;
  tradeDate: string;
  ticker: string;
  side: string;
  quantity: number;
  price: number;
  fees: number | null;
  notes: string | null;
  portfolio: {
    user: {
      id: number;
      name: string | null;
      email: string;
    };
  };
}

interface User {
  id: number;
  name: string | null;
  email: string;
}

interface TransactionForm {
  userId: string;
  ticker: string;
  side: string;
  quantity: string;
  price: string;
  tradeDate: string;
  fees: string;
  notes: string;
}

const emptyForm: TransactionForm = {
  userId: "",
  ticker: "",
  side: "BUY",
  quantity: "",
  price: "",
  tradeDate: new Date().toISOString().split("T")[0],
  fees: "",
  notes: "",
};

export default function AdminHoldingsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TransactionForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    if (selectedUserId) {
      fetchTransactions(selectedUserId);
    }
  }, [selectedUserId]);

  const fetchUsers = async () => {
    try {
      const response = await fetch("/api/admin/users");
      if (!response.ok) throw new Error("Failed to fetch users");
      const data = await response.json();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const fetchTransactions = async (userId: string) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/admin/holdings?userId=${userId}`);
      if (!response.ok) throw new Error("Failed to fetch holdings");
      const data = await response.json();
      setTransactions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const payload = {
        userId: parseInt(form.userId),
        ticker: form.ticker,
        side: form.side,
        quantity: parseFloat(form.quantity),
        price: parseFloat(form.price),
        tradeDate: form.tradeDate,
        fees: form.fees ? parseFloat(form.fees) : null,
        notes: form.notes || null,
      };

      const url = editingId ? `/api/admin/holdings?id=${editingId}` : "/api/admin/holdings";
      const method = editingId ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save");
      }

      setShowModal(false);
      setForm(emptyForm);
      setEditingId(null);
      if (selectedUserId) fetchTransactions(selectedUserId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (tx: Transaction) => {
    setEditingId(tx.id);
    setForm({
      userId: tx.portfolio.user.id.toString(),
      ticker: tx.ticker,
      side: tx.side,
      quantity: tx.quantity.toString(),
      price: tx.price.toString(),
      tradeDate: new Date(tx.tradeDate).toISOString().split("T")[0],
      fees: tx.fees?.toString() || "",
      notes: tx.notes || "",
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this transaction?")) return;
    try {
      const response = await fetch(`/api/admin/holdings?id=${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete");
      if (selectedUserId) fetchTransactions(selectedUserId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const getSideColor = (side: string) => {
    return side === "BUY" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800";
  };

  const calculateTotal = (txs: Transaction[]) => {
    return txs.reduce((acc, tx) => {
      const amount = tx.quantity * tx.price;
      return tx.side === "BUY" ? acc + amount : acc - amount;
    }, 0);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Holdings Management</h1>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
          <button onClick={() => setError(null)} className="mt-2 text-red-600 hover:text-red-800 text-sm">
            Dismiss
          </button>
        </div>
      )}

      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Select User</label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- Select a user --</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name || user.email} ({user.email})
                </option>
              ))}
            </select>
          </div>
          {selectedUserId && (
            <button
              onClick={() => {
                setForm({ ...emptyForm, userId: selectedUserId });
                setEditingId(null);
                setShowModal(true);
              }}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Add Transaction
            </button>
          )}
        </div>
      </div>

      {selectedUserId && (
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <div className="px-4 py-5 sm:px-6 border-b border-gray-200 flex justify-between items-center">
            <div>
              <h3 className="text-lg leading-6 font-medium text-gray-900">
                Transactions ({transactions.length})
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                Net: ₹{calculateTotal(transactions).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="p-8">
              <div className="animate-pulse space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="bg-gray-200 h-16 rounded"></div>
                ))}
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {transactions.map((tx) => (
                <li key={tx.id}>
                  <div className="px-4 py-4 sm:px-6">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col flex-1">
                        <div className="flex items-center space-x-3">
                          <p className="text-lg font-bold text-blue-600">{tx.ticker}</p>
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getSideColor(tx.side)}`}>
                            {tx.side}
                          </span>
                        </div>
                        <div className="mt-2 sm:flex sm:justify-between">
                          <div className="sm:flex space-x-6 text-sm text-gray-500">
                            <span>Qty: {tx.quantity}</span>
                            <span>Price: ₹{tx.price}</span>
                            <span>Total: ₹{(tx.quantity * tx.price).toLocaleString()}</span>
                            {tx.fees && <span>Fees: ₹{tx.fees}</span>}
                          </div>
                          <div className="mt-2 flex items-center text-sm text-gray-500 sm:mt-0">
                            <p>{new Date(tx.tradeDate).toLocaleDateString()}</p>
                          </div>
                        </div>
                        {tx.notes && <p className="mt-2 text-sm text-gray-600">{tx.notes}</p>}
                      </div>
                      <div className="flex items-center space-x-3 ml-4">
                        <button
                          onClick={() => handleEdit(tx)}
                          className="text-indigo-600 hover:text-indigo-900 border border-indigo-600 px-3 py-1 rounded text-sm transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(tx.id)}
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
          )}

          {!loading && transactions.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-gray-500">No transactions found for this user.</p>
            </div>
          )}
        </div>
      )}

      {!selectedUserId && (
        <div className="bg-gray-50 rounded-lg p-8 text-center">
          <p className="text-gray-500">Select a user to view their holdings.</p>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-screen items-center justify-center p-4">
            <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowModal(false)}></div>
            <div className="relative bg-white rounded-lg shadow-xl max-w-lg w-full">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">
                  {editingId ? "Edit Transaction" : "Add Transaction"}
                </h3>
              </div>
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">User *</label>
                  <select
                    value={form.userId}
                    onChange={(e) => setForm({ ...form, userId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    <option value="">-- Select user --</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name || user.email} ({user.email})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Symbol *</label>
                    <input
                      type="text"
                      value={form.ticker}
                      onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Side *</label>
                    <select
                      value={form.side}
                      onChange={(e) => setForm({ ...form, side: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="BUY">BUY</option>
                      <option value="SELL">SELL</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Quantity *</label>
                    <input
                      type="number"
                      step="0.000001"
                      value={form.quantity}
                      onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Price *</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.price}
                      onChange={(e) => setForm({ ...form, price: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Trade Date *</label>
                    <input
                      type="date"
                      value={form.tradeDate}
                      onChange={(e) => setForm({ ...form, tradeDate: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fees</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.fees}
                      onChange={(e) => setForm({ ...form, fees: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {saving ? "Saving..." : editingId ? "Update" : "Create"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
