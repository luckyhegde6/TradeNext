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
    return side === "BUY" ? "bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-400 border border-green-200 dark:border-green-800" : "bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-400 border border-red-200 dark:border-red-800";
  };

  const calculateTotal = (txs: Transaction[]) => {
    return txs.reduce((acc, tx) => {
      const amount = tx.quantity * tx.price;
      return tx.side === "BUY" ? acc + amount : acc - amount;
    }, 0);
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b dark:border-slate-800 pb-6 gap-4">
        <div>
          <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white tracking-tight">Portfolio Holdings</h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1 font-medium">Manage user transactions and portfolio equity.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm font-bold text-gray-700 dark:text-slate-300 whitespace-nowrap">Admin User Switch:</label>
          <select
            className="bg-white dark:bg-slate-900 border-2 border-gray-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-blue-500/20 transition-all shadow-sm outline-none"
            value={selectedUserId || ""}
            onChange={(e) => setSelectedUserId(e.target.value)}
          >
            <option value="">Select User Account...</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || u.email} ({u.email})
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl p-4">
          <p className="text-red-800 dark:text-red-400 font-medium">{error}</p>
          <button onClick={() => setError(null)} className="mt-2 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 text-sm font-bold">
            Dismiss
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/50 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
              <span className="w-2 h-6 bg-blue-600 rounded-full"></span>
              Transactions ({transactions.length})
            </h2>
            {selectedUserId && (
              <p className="mt-1 text-sm font-bold text-gray-500 dark:text-slate-400">
                Net Exposure: ₹{calculateTotal(transactions).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            )}
          </div>
          <button
            onClick={() => {
              setEditingId(null);
              setForm({ ...emptyForm, userId: selectedUserId });
              setShowModal(true);
            }}
            disabled={!selectedUserId}
            className="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-blue-700 disabled:opacity-30 transition-all shadow-lg active:scale-95 flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            Add Transaction
          </button>
        </div>

        {selectedUserId ? (
          loading ? (
            <div className="p-8">
              <div className="animate-pulse space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="bg-gray-100 dark:bg-slate-800 h-16 rounded-xl"></div>
                ))}
              </div>
            </div>
          ) : transactions.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-gray-50 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <p className="text-gray-500 dark:text-slate-400 font-bold">No transactions found for this user.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50/50 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Symbol</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Type</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Quantity</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Price</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Total</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Date</th>
                    <th className="px-6 py-4 text-right text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-800">
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-black text-blue-600 dark:text-blue-400">{tx.ticker}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`px-2.5 py-1 text-[10px] font-black rounded-full uppercase tracking-tighter ${getSideColor(tx.side)}`}>
                          {tx.side}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white font-medium">{tx.quantity}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white font-medium">₹{tx.price.toLocaleString()}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white font-bold">₹{(tx.quantity * tx.price).toLocaleString()}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-slate-500 font-mono italic">{new Date(tx.tradeDate).toLocaleDateString()}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                        <button
                          onClick={() => handleEdit(tx)}
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-bold transition-all"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(tx.id)}
                          className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-bold transition-all"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="p-16 text-center">
            <div className="w-20 h-20 bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="h-10 w-10 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">No Account Selected</h3>
            <p className="text-gray-500 dark:text-slate-400 max-w-sm mx-auto">Please select a user account from the dropdown above to manage their portfolio transactions.</p>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-screen items-center justify-center p-4">
            <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm transition-opacity" onClick={() => setShowModal(false)}></div>
            <div className="relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-100 dark:border-slate-800 animate-in fade-in zoom-in duration-300">
              <div className="px-8 py-6 border-b border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/50 flex justify-between items-center">
                <h3 className="text-2xl font-black text-gray-900 dark:text-white">
                  {editingId ? "Edit Trade" : "New Trade Entry"}
                </h3>
                <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <form onSubmit={handleSubmit} className="p-8 space-y-5">
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2 ml-1">Account Holder *</label>
                  <select
                    value={form.userId}
                    onChange={(e) => setForm({ ...form, userId: e.target.value })}
                    className="w-full px-4 py-3 bg-white dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-blue-500/20 transition-all outline-none"
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
                    <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2 ml-1">Symbol *</label>
                    <input
                      type="text"
                      value={form.ticker}
                      onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })}
                      className="w-full px-4 py-3 bg-white dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-blue-500/20 transition-all outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2 ml-1">Type *</label>
                    <select
                      value={form.side}
                      onChange={(e) => setForm({ ...form, side: e.target.value })}
                      className="w-full px-4 py-3 bg-white dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-blue-500/20 transition-all outline-none"
                      required
                    >
                      <option value="BUY">BUY</option>
                      <option value="SELL">SELL</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2 ml-1">Quantity *</label>
                    <input
                      type="number"
                      step="0.000001"
                      value={form.quantity}
                      onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                      className="w-full px-4 py-3 bg-white dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-blue-500/20 transition-all outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2 ml-1">Price (₹) *</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.price}
                      onChange={(e) => setForm({ ...form, price: e.target.value })}
                      className="w-full px-4 py-3 bg-white dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-blue-500/20 transition-all outline-none"
                      required
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2 ml-1">Trade Date *</label>
                    <input
                      type="date"
                      value={form.tradeDate}
                      onChange={(e) => setForm({ ...form, tradeDate: e.target.value })}
                      className="w-full px-4 py-3 bg-white dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-blue-500/20 transition-all outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2 ml-1">Fees</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.fees}
                      onChange={(e) => setForm({ ...form, fees: e.target.value })}
                      className="w-full px-4 py-3 bg-white dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-blue-500/20 transition-all outline-none"
                    />
                  </div>
                </div>
                <div className="pt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="flex-1 px-6 py-4 bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 rounded-xl font-bold hover:bg-gray-200 dark:hover:bg-slate-700 transition-all active:scale-95 transition-all active:scale-95"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 px-6 py-4 bg-blue-600 text-white rounded-xl font-black hover:bg-blue-700 shadow-lg shadow-blue-500/30 transition-all active:scale-95 disabled:opacity-50"
                  >
                    {saving ? "Saving..." : editingId ? "Save Changes" : "Confirm Trade"}
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
