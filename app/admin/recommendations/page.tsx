"use client";

import { useState, useEffect, useRef } from "react";

interface StockRecommendation {
  id: string;
  symbol: string;
  entryRange: string | null;
  shortTerm: string | null;
  longTerm: string | null;
  intraday: string | null;
  recommendation: string;
  analystRating: string | null;
  profitRangeMin: number | null;
  profitRangeMax: number | null;
  targetPrice: number | null;
  analysis: string | null;
  imageUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RecommendationForm {
  symbol: string;
  entryRange: string;
  shortTerm: string;
  longTerm: string;
  intraday: string;
  recommendation: string;
  analystRating: string;
  profitRangeMin: string;
  profitRangeMax: string;
  targetPrice: string;
  analysis: string;
  imageUrl: string;
}

const emptyForm: RecommendationForm = {
  symbol: "",
  entryRange: "",
  shortTerm: "",
  longTerm: "",
  intraday: "",
  recommendation: "HOLD",
  analystRating: "",
  profitRangeMin: "",
  profitRangeMax: "",
  targetPrice: "",
  analysis: "",
  imageUrl: "",
};

export default function AdminRecommendationsPage() {
  const [recommendations, setRecommendations] = useState<StockRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RecommendationForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbolQuery, setSymbolQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchRecommendations();
  }, []);

  useEffect(() => {
    if (showModal && symbols.length === 0) {
      fetchSymbols();
    }
  }, [showModal]);

  const fetchSymbols = async () => {
    try {
      const response = await fetch("/api/admin/symbols");
      if (response.ok) {
        const data = await response.json();
        setSymbols(data.symbols || []);
      }
    } catch (err) {
      console.error("Failed to fetch symbols:", err);
    }
  };

  const fetchRecommendations = async () => {
    try {
      const response = await fetch("/api/admin/recommendations");
      if (!response.ok) throw new Error("Failed to fetch recommendations");
      const data = await response.json();
      setRecommendations(data);
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
        ...form,
        profitRangeMin: form.profitRangeMin ? parseFloat(form.profitRangeMin) : null,
        profitRangeMax: form.profitRangeMax ? parseFloat(form.profitRangeMax) : null,
        targetPrice: form.targetPrice ? parseFloat(form.targetPrice) : null,
      };

      const url = editingId ? `/api/admin/recommendations?id=${editingId}` : "/api/admin/recommendations";
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
      fetchRecommendations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (rec: StockRecommendation) => {
    setEditingId(rec.id);
    setForm({
      symbol: rec.symbol,
      entryRange: rec.entryRange || "",
      shortTerm: rec.shortTerm || "",
      longTerm: rec.longTerm || "",
      intraday: rec.intraday || "",
      recommendation: rec.recommendation,
      analystRating: rec.analystRating || "",
      profitRangeMin: rec.profitRangeMin?.toString() || "",
      profitRangeMax: rec.profitRangeMax?.toString() || "",
      targetPrice: rec.targetPrice?.toString() || "",
      analysis: rec.analysis || "",
      imageUrl: rec.imageUrl || "",
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this recommendation?")) return;
    try {
      const response = await fetch(`/api/admin/recommendations?id=${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete");
      fetchRecommendations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleToggleActive = async (rec: StockRecommendation) => {
    try {
      await fetch("/api/admin/recommendations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rec.id, isActive: !rec.isActive }),
      });
      fetchRecommendations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError("Image size must be less than 5MB");
      return;
    }

    setImageUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setForm({ ...form, imageUrl: base64 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process image");
    } finally {
      setImageUploading(false);
    }
  };

  const getRecommendationColor = (rec: string) => {
    switch (rec) {
      case "BUY":
      case "ACCUMULATE":
        return "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-300";
      case "SELL":
        return "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-300";
      case "HOLD":
        return "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-300";
      default:
        return "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-300";
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Stock Recommendations</h1>
        <div className="animate-pulse space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-gray-200 dark:bg-slate-800 h-24 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Stock Recommendations</h1>
        <button
          onClick={() => {
            setForm(emptyForm);
            setEditingId(null);
            setShowModal(true);
          }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Add Recommendation
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-800 dark:text-red-400">{error}</p>
          <button onClick={() => setError(null)} className="mt-2 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 text-sm">
            Dismiss
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 shadow overflow-hidden sm:rounded-md">
        <div className="px-4 py-5 sm:px-6 border-b border-gray-200 dark:border-slate-700">
          <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-white">
            Recommendations ({recommendations.length})
          </h3>
        </div>
        <ul className="divide-y divide-gray-200 dark:divide-slate-800">
          {recommendations.map((rec) => (
            <li key={rec.id}>
              <div className="px-4 py-4 sm:px-6">
                <div className="flex items-center justify-between">
                  <div className="flex flex-1 flex-col">
                    <div className="flex items-center space-x-3">
                      <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{rec.symbol}</p>
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getRecommendationColor(rec.recommendation)}`}>
                        {rec.recommendation}
                      </span>
                      {!rec.isActive && (
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300">
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="mt-2 sm:flex sm:justify-between">
                      <div className="sm:flex space-x-6 text-sm text-gray-500 dark:text-gray-400">
                        {rec.targetPrice && <span>Target: ₹{rec.targetPrice}</span>}
                        {rec.profitRangeMin && rec.profitRangeMax && (
                          <span>Profit: ₹{rec.profitRangeMin} - ₹{rec.profitRangeMax}</span>
                        )}
                        {rec.analystRating && <span>Rating: {rec.analystRating}</span>}
                      </div>
                      <div className="mt-2 flex items-center text-sm text-gray-500 dark:text-gray-400 sm:mt-0">
                        <p>{new Date(rec.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                    {rec.analysis && (
                      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 line-clamp-2">{rec.analysis}</p>
                    )}
                    {rec.imageUrl && (
                      <div className="mt-2">
                        <img src={rec.imageUrl} alt="Chart" className="max-w-xs rounded border dark:border-slate-600" />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center space-x-3 ml-4">
                    <button
                      onClick={() => handleToggleActive(rec)}
                      className={`px-3 py-1 rounded text-sm border transition-colors ${rec.isActive
                          ? "text-orange-600 dark:text-orange-400 border-orange-600 dark:border-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/30"
                          : "text-green-600 dark:text-green-400 border-green-600 dark:border-green-500 hover:bg-green-50 dark:hover:bg-green-900/30"
                        }`}
                    >
                      {rec.isActive ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      onClick={() => handleEdit(rec)}
                      className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-900 dark:hover:text-indigo-300 border border-indigo-600 dark:border-indigo-500 px-3 py-1 rounded text-sm transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(rec.id)}
                      className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300 border border-red-600 dark:border-red-500 px-3 py-1 rounded text-sm transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {recommendations.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-gray-500 dark:text-gray-400">No recommendations found.</p>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-screen items-center justify-center p-4">
            <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowModal(false)}></div>
            <div className="relative bg-white dark:bg-slate-900 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {editingId ? "Edit Recommendation" : "Add Recommendation"}
                </h3>
              </div>
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Symbol *</label>
                    <input
                      type="text"
                      list="symbol-list"
                      value={form.symbol}
                      onChange={(e) => {
                        setForm({ ...form, symbol: e.target.value.toUpperCase() });
                        setSymbolQuery(e.target.value);
                      }}
                      onBlur={() => {
                        if (symbolQuery && !symbols.includes(symbolQuery.toUpperCase())) {
                          const match = symbols.find(s => s.toLowerCase().startsWith(symbolQuery.toLowerCase()));
                          if (match) {
                            setForm({ ...form, symbol: match });
                          }
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 dark:text-white"
                      required
                    />
                    <datalist id="symbol-list">
                      {symbols.map((sym) => (
                        <option key={sym} value={sym} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Recommendation *</label>
                    <select
                      value={form.recommendation}
                      onChange={(e) => setForm({ ...form, recommendation: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 dark:text-white"
                    >
                      <option value="BUY">BUY</option>
                      <option value="ACCUMULATE">ACCUMULATE</option>
                      <option value="HOLD">HOLD</option>
                      <option value="SELL">SELL</option>
                      <option value="NEUTRAL">NEUTRAL</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Entry Range</label>
                    <input
                      type="text"
                      value={form.entryRange}
                      onChange={(e) => setForm({ ...form, entryRange: e.target.value })}
                      placeholder="e.g., 1450-1500"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Target Price</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.targetPrice}
                      onChange={(e) => setForm({ ...form, targetPrice: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Short Term</label>
                    <input
                      type="text"
                      value={form.shortTerm}
                      onChange={(e) => setForm({ ...form, shortTerm: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Long Term</label>
                    <input
                      type="text"
                      value={form.longTerm}
                      onChange={(e) => setForm({ ...form, longTerm: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Intraday</label>
                    <input
                      type="text"
                      value={form.intraday}
                      onChange={(e) => setForm({ ...form, intraday: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Profit Range Min</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.profitRangeMin}
                      onChange={(e) => setForm({ ...form, profitRangeMin: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Profit Range Max</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.profitRangeMax}
                      onChange={(e) => setForm({ ...form, profitRangeMax: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Analyst Rating</label>
                  <input
                    type="text"
                    value={form.analystRating}
                    onChange={(e) => setForm({ ...form, analystRating: e.target.value })}
                    placeholder="e.g., 4.5/5"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Analysis</label>
                  <textarea
                    value={form.analysis}
                    onChange={(e) => setForm({ ...form, analysis: e.target.value })}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Chart Image</label>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleImageUpload}
                    accept="image/*"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 dark:text-white"
                  />
                  {imageUploading && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Uploading...</p>}
                  {form.imageUrl && (
                    <div className="mt-2">
                      <img src={form.imageUrl} alt="Chart preview" className="max-w-xs rounded border dark:border-slate-600" />
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, imageUrl: "" })}
                        className="text-sm text-red-600 hover:underline mt-1"
                      >
                        Remove image
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="bg-gray-500 dark:bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-600 dark:hover:bg-gray-700 transition-colors"
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
