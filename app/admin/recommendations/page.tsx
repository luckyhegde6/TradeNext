"use client";

import { useState, useEffect, useRef, useMemo } from "react";

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

type SortField = "symbol" | "recommendation" | "targetPrice" | "createdAt";
type SortOrder = "asc" | "desc";

const ITEMS_PER_PAGE = 10;

export default function AdminRecommendationsPage() {
  const [recommendations, setRecommendations] = useState<StockRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RecommendationForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbolQuery, setSymbolQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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

    if (!editingId) {
      const isDuplicate = recommendations.some(
        (r) => r.symbol.toUpperCase() === form.symbol.toUpperCase()
      );
      if (isDuplicate) {
        setError(`A recommendation for "${form.symbol.toUpperCase()}" already exists. Use Edit to modify it.`);
        setSaving(false);
        return;
      }
    }

    try {
      const payload = {
        id: editingId,
        ...form,
        profitRangeMin: form.profitRangeMin ? parseFloat(form.profitRangeMin) : null,
        profitRangeMax: form.profitRangeMax ? parseFloat(form.profitRangeMax) : null,
        targetPrice: form.targetPrice ? parseFloat(form.targetPrice) : null,
      };

      const url = editingId ? "/api/admin/recommendations" : "/api/admin/recommendations";
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

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.size} recommendation(s)?`)) return;

    try {
      await Promise.all(
        Array.from(selectedIds).map((id) =>
          fetch(`/api/admin/recommendations?id=${id}`, { method: "DELETE" })
        )
      );
      setSelectedIds(new Set());
      fetchRecommendations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleBulkToggleActive = async (activate: boolean) => {
    if (selectedIds.size === 0) return;

    try {
      const results = await Promise.all(
        Array.from(selectedIds).map((id) =>
          fetch("/api/admin/recommendations", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, isActive: activate }),
          })
        )
      );

      const hasError = results.some(r => !r.ok);
      if (hasError) {
        throw new Error("Some updates failed");
      }

      setSelectedIds(new Set());
      fetchRecommendations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    }
  };

  const handleToggleActive = async (rec: StockRecommendation) => {
    try {
      const response = await fetch("/api/admin/recommendations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rec.id, isActive: !rec.isActive }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update");
      }

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

  const openImageModal = (imageUrl: string) => {
    setSelectedImage(imageUrl);
    setShowImageModal(true);
  };

  const exportToCSV = () => {
    const headers = [
      "Symbol",
      "Recommendation",
      "Entry Range",
      "Target Price",
      "Short Term",
      "Long Term",
      "Intraday",
      "Profit Range Min",
      "Profit Range Max",
      "Analyst Rating",
      "Analysis",
      "Status",
      "Created At",
    ];

    const rows = filteredRecommendations.map((rec) => [
      rec.symbol,
      rec.recommendation,
      rec.entryRange || "",
      rec.targetPrice?.toString() || "",
      rec.shortTerm || "",
      rec.longTerm || "",
      rec.intraday || "",
      rec.profitRangeMin?.toString() || "",
      rec.profitRangeMax?.toString() || "",
      rec.analystRating || "",
      rec.analysis || "",
      rec.isActive ? "Active" : "Inactive",
      new Date(rec.createdAt).toLocaleDateString(),
    ]);

    const csvContent = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recommendations_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredRecommendations.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRecommendations.map((r) => r.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
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

  const filteredRecommendations = useMemo(() => {
    let result = [...recommendations];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.symbol.toLowerCase().includes(query) ||
          r.analysis?.toLowerCase().includes(query) ||
          r.recommendation.toLowerCase().includes(query)
      );
    }

    if (filterType !== "all") {
      result = result.filter((r) => r.recommendation === filterType);
    }

    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "symbol":
          comparison = a.symbol.localeCompare(b.symbol);
          break;
        case "recommendation":
          comparison = a.recommendation.localeCompare(b.recommendation);
          break;
        case "targetPrice":
          comparison = (a.targetPrice || 0) - (b.targetPrice || 0);
          break;
        case "createdAt":
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });

    return result;
  }, [recommendations, searchQuery, filterType, sortField, sortOrder]);

  const paginatedRecommendations = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredRecommendations.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredRecommendations, currentPage]);

  const totalPages = Math.ceil(filteredRecommendations.length / ITEMS_PER_PAGE);

  const stats = useMemo(() => {
    const total = recommendations.length;
    const active = recommendations.filter((r) => r.isActive).length;
    const buy = recommendations.filter((r) => r.recommendation === "BUY" || r.recommendation === "ACCUMULATE").length;
    const sell = recommendations.filter((r) => r.recommendation === "SELL").length;
    const hold = recommendations.filter((r) => r.recommendation === "HOLD" || r.recommendation === "NEUTRAL").length;
    return { total, active, buy, sell, hold };
  }, [recommendations]);

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
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b dark:border-slate-800 pb-6 gap-4">
          <div>
            <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white tracking-tight">Stock Recommendations</h1>
            <p className="text-gray-500 dark:text-slate-400 mt-1 font-medium">Manage expert stock picks and technical analysis.</p>
          </div>
          <button
            onClick={() => {
              setForm(emptyForm);
              setEditingId(null);
              setShowModal(true);
            }}
            className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg active:scale-95 flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            Add Recommendation
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
          <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-2xl p-5 shadow-xl hover:shadow-2xl transition-all group">
            <h3 className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-1">Total</h3>
            <p className="text-2xl font-black text-gray-900 dark:text-white">{stats.total}</p>
            <div className="h-1 w-8 bg-gray-400 rounded-full mt-3 group-hover:w-full transition-all duration-500"></div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-2xl p-5 shadow-xl hover:shadow-2xl transition-all group">
            <h3 className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-1">Active</h3>
            <p className="text-2xl font-black text-green-600 dark:text-green-400">{stats.active}</p>
            <div className="h-1 w-8 bg-green-500 rounded-full mt-3 group-hover:w-full transition-all duration-500"></div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-2xl p-5 shadow-xl hover:shadow-2xl transition-all group">
            <h3 className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-1">Buy</h3>
            <p className="text-2xl font-black text-blue-600 dark:text-blue-400">{stats.buy}</p>
            <div className="h-1 w-8 bg-blue-500 rounded-full mt-3 group-hover:w-full transition-all duration-500"></div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-2xl p-5 shadow-xl hover:shadow-2xl transition-all group">
            <h3 className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-1">Sell</h3>
            <p className="text-2xl font-black text-red-600 dark:text-red-400">{stats.sell}</p>
            <div className="h-1 w-8 bg-red-500 rounded-full mt-3 group-hover:w-full transition-all duration-500"></div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-2xl p-5 shadow-xl hover:shadow-2xl transition-all group">
            <h3 className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-1">Hold</h3>
            <p className="text-2xl font-black text-yellow-600 dark:text-yellow-400">{stats.hold}</p>
            <div className="h-1 w-8 bg-yellow-500 rounded-full mt-3 group-hover:w-full transition-all duration-500"></div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-red-800 dark:text-red-400">{error}</p>
            <button onClick={() => setError(null)} className="mt-2 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 text-sm">
              Dismiss
            </button>
          </div>
        )}

        <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/50 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <div>
              <h2 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                <span className="w-2 h-6 bg-blue-600 rounded-full"></span>
                Recommendations ({filteredRecommendations.length})
              </h2>
            </div>
            <button
              onClick={exportToCSV}
              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-bold text-sm bg-blue-50 dark:bg-blue-900/20 px-4 py-2 rounded-xl transition-all"
            >
              Export CSV
            </button>
          </div>

          <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900/50 flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="Search by symbol or analysis..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-2 border-transparent focus:border-blue-500/50 rounded-xl text-gray-900 dark:text-white font-medium focus:ring-4 focus:ring-blue-500/10 transition-all outline-none"
              />
              <svg className="h-5 w-5 text-gray-400 absolute left-3 top-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <select
              value={filterType}
              onChange={(e) => {
                setFilterType(e.target.value);
                setCurrentPage(1);
              }}
              className="px-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-2 border-transparent focus:border-blue-500/50 rounded-xl text-gray-900 dark:text-white font-bold transition-all outline-none"
            >
              <option value="all">All Types</option>
              <option value="BUY">BUY</option>
              <option value="ACCUMULATE">ACCUMULATE</option>
              <option value="HOLD">HOLD</option>
              <option value="SELL">SELL</option>
              <option value="NEUTRAL">NEUTRAL</option>
            </select>
            <select
              value={`${sortField}-${sortOrder}`}
              onChange={(e) => {
                const [field, order] = e.target.value.split("-") as [SortField, SortOrder];
                setSortField(field);
                setSortOrder(order);
              }}
              className="px-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-2 border-transparent focus:border-blue-500/50 rounded-xl text-gray-900 dark:text-white font-bold transition-all outline-none"
            >
              <option value="createdAt-desc">Newest First</option>
              <option value="createdAt-asc">Oldest First</option>
              <option value="symbol-asc">Symbol A-Z</option>
              <option value="symbol-desc">Symbol Z-A</option>
              <option value="recommendation-asc">Type A-Z</option>
              <option value="recommendation-desc">Type Z-A</option>
              <option value="targetPrice-desc">Target Price High-Low</option>
              <option value="targetPrice-asc">Target Price Low-High</option>
            </select>
          </div>

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <span>{selectedIds.size} selected</span>
              <button
                onClick={() => handleBulkToggleActive(true)}
                className="text-green-600 dark:text-green-400 hover:underline"
              >
                Activate
              </button>
              <span>|</span>
              <button
                onClick={() => handleBulkToggleActive(false)}
                className="text-orange-600 dark:text-orange-400 hover:underline"
              >
                Deactivate
              </button>
              <span>|</span>
              <button
                onClick={handleBulkDelete}
                className="text-red-600 dark:text-red-400 hover:underline"
              >
                Delete
              </button>
            </div>
          )}
        </div>

        <ul className="divide-y divide-gray-100 dark:divide-slate-800">
          <li className="px-6 py-4 bg-gray-50/30 dark:bg-slate-800/20">
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={selectedIds.size === filteredRecommendations.length && filteredRecommendations.length > 0}
                onChange={toggleSelectAll}
                className="h-5 w-5 text-blue-600 border-gray-300 dark:border-slate-700 rounded-lg accent-blue-600"
              />
              <span className="ml-3 text-sm font-bold text-gray-500 dark:text-slate-500 uppercase tracking-widest">Select All Items</span>
            </div>
          </li>
          {paginatedRecommendations.map((rec) => (
            <li key={rec.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/10 transition-colors">
              <div className="px-6 py-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(rec.id)}
                      onChange={() => toggleSelect(rec.id)}
                      className="h-5 w-5 text-blue-600 border-gray-300 dark:border-slate-700 rounded-lg accent-blue-600 mt-1"
                    />
                    <div className="flex flex-col">
                      <div className="flex items-center gap-3">
                        <p className="text-xl font-black text-blue-600 dark:text-blue-400 tracking-tight">{rec.symbol}</p>
                        <span className={`px-2.5 py-1 text-[10px] font-black rounded-full uppercase tracking-tighter border ${getRecommendationColor(rec.recommendation)}`}>
                          {rec.recommendation}
                        </span>
                        {!rec.isActive && (
                          <span className="px-2.5 py-1 text-[10px] font-black rounded-full border border-gray-200 dark:border-slate-700 bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-500 uppercase tracking-tighter">
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                        {rec.targetPrice && <span className="font-bold text-gray-900 dark:text-white">Target: <span className="text-blue-600 dark:text-blue-400">₹{rec.targetPrice}</span></span>}
                        {rec.profitRangeMin && rec.profitRangeMax && (
                          <span className="font-bold text-gray-900 dark:text-white">Profit: <span className="text-green-600 dark:text-green-400">₹{rec.profitRangeMin} - ₹{rec.profitRangeMax}</span></span>
                        )}
                        {rec.analystRating && <span className="font-bold text-gray-700 dark:text-slate-400">Rating: {rec.analystRating}</span>}
                        <span className="font-mono text-gray-400 dark:text-slate-600 italic">{new Date(rec.createdAt).toLocaleDateString()}</span>
                      </div>
                      {rec.analysis && (
                        <p className="mt-3 text-sm text-gray-600 dark:text-slate-400 leading-relaxed max-w-2xl line-clamp-2">{rec.analysis}</p>
                      )}
                      {rec.imageUrl && (
                        <div className="mt-4">
                          <div className="relative group/img overflow-hidden rounded-2xl border-2 border-gray-100 dark:border-slate-800 shadow-xl max-w-xs transition-transform hover:scale-[1.02]">
                            <img
                              src={rec.imageUrl}
                              alt="Chart"
                              className="w-full h-auto cursor-pointer"
                              onClick={() => openImageModal(rec.imageUrl!)}
                            />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                              <span className="text-white font-black text-xs uppercase tracking-widest">View Full Chart</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row items-center gap-3 ml-4">
                    <button
                      onClick={() => handleToggleActive(rec)}
                      className={`min-w-[100px] px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest border-2 transition-all ${rec.isActive
                        ? "text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-900/50 hover:bg-orange-600 hover:text-white"
                        : "text-green-600 dark:text-green-400 border-green-200 dark:border-green-900/50 hover:bg-green-600 hover:text-white"
                        }`}
                    >
                      {rec.isActive ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      onClick={() => handleEdit(rec)}
                      className="min-w-[80px] px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest border-2 border-blue-100 dark:border-blue-900/50 text-blue-600 dark:text-blue-400 hover:bg-blue-600 hover:text-white transition-all"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(rec.id)}
                      className="min-w-[80px] px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest border-2 border-red-100 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-600 hover:text-white transition-all"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {filteredRecommendations.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-gray-500 dark:text-gray-400">No recommendations found.</p>
          </div>
        )}

        {totalPages > 1 && (
          <div className="px-6 py-5 flex items-center justify-between border-t border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/30">
            <div className="text-sm font-bold text-gray-500 dark:text-slate-500">
              Showing <span className="text-gray-900 dark:text-white">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> to <span className="text-gray-900 dark:text-white">{Math.min(currentPage * ITEMS_PER_PAGE, filteredRecommendations.length)}</span> of <span className="text-gray-900 dark:text-white">{filteredRecommendations.length}</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-4 py-2 rounded-xl border-2 border-gray-100 dark:border-slate-800 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white dark:hover:bg-slate-800 transition-all font-bold text-sm"
              >
                Previous
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-10 h-10 rounded-xl border-2 transition-all font-black text-sm ${page === currentPage
                      ? "bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-500/30"
                      : "border-gray-100 dark:border-slate-800 hover:bg-white dark:hover:bg-slate-800 text-gray-500 dark:text-slate-500"
                    }`}
                >
                  {page}
                </button>
              ))}
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-4 py-2 rounded-xl border-2 border-gray-100 dark:border-slate-800 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white dark:hover:bg-slate-800 transition-all font-bold text-sm"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-screen items-center justify-center p-4">
            <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm transition-opacity" onClick={() => setShowModal(false)}></div>
            <div className="relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden border border-gray-100 dark:border-slate-800 animate-in fade-in zoom-in duration-300 flex flex-col">
              <div className="px-8 py-6 border-b border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/50 flex justify-between items-center shrink-0">
                <h3 className="text-2xl font-black text-gray-900 dark:text-white">
                  {editingId ? "Edit Recommendation" : "New Recommendation"}
                </h3>
                <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <form onSubmit={handleSubmit} className="p-8 space-y-6 overflow-y-auto">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2 ml-1">Symbol *</label>
                    <input
                      type="text"
                      list="symbol-list"
                      value={form.symbol}
                      onChange={(e) => {
                        setForm({ ...form, symbol: e.target.value.toUpperCase() });
                        setSymbolQuery(e.target.value);
                      }}
                      className="w-full px-4 py-3 bg-white dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-blue-500/20 transition-all outline-none"
                      required
                    />
                    <datalist id="symbol-list">
                      {symbols.map((sym) => (
                        <option key={sym} value={sym} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2 ml-1">Rating *</label>
                    <select
                      value={form.recommendation}
                      onChange={(e) => setForm({ ...form, recommendation: e.target.value })}
                      className="w-full px-4 py-3 bg-white dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-blue-500/20 transition-all outline-none"
                    >
                      <option value="BUY">BUY</option>
                      <option value="ACCUMULATE">ACCUMULATE</option>
                      <option value="HOLD">HOLD</option>
                      <option value="SELL">SELL</option>
                      <option value="NEUTRAL">NEUTRAL</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2 ml-1">Entry Range</label>
                    <input
                      type="text"
                      value={form.entryRange}
                      onChange={(e) => setForm({ ...form, entryRange: e.target.value })}
                      placeholder="e.g., 1450-1500"
                      className="w-full px-4 py-3 bg-white dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-blue-500/20 transition-all outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2 ml-1">Target Price</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.targetPrice}
                      onChange={(e) => setForm({ ...form, targetPrice: e.target.value })}
                      className="w-full px-4 py-3 bg-white dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-blue-500/20 transition-all outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2 ml-1 text-xs">Short Term</label>
                    <input
                      type="text"
                      value={form.shortTerm}
                      onChange={(e) => setForm({ ...form, shortTerm: e.target.value })}
                      className="w-full px-4 py-3 bg-white dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-blue-500/20 transition-all outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2 ml-1 text-xs">Long Term</label>
                    <input
                      type="text"
                      value={form.longTerm}
                      onChange={(e) => setForm({ ...form, longTerm: e.target.value })}
                      className="w-full px-4 py-3 bg-white dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-blue-500/20 transition-all outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2 ml-1 text-xs">Intraday</label>
                    <input
                      type="text"
                      value={form.intraday}
                      onChange={(e) => setForm({ ...form, intraday: e.target.value })}
                      className="w-full px-4 py-3 bg-white dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-blue-500/20 transition-all outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2 ml-1">Profit Range Min</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.profitRangeMin}
                      onChange={(e) => setForm({ ...form, profitRangeMin: e.target.value })}
                      className="w-full px-4 py-3 bg-white dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-blue-500/20 transition-all outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2 ml-1">Profit Range Max</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.profitRangeMax}
                      onChange={(e) => setForm({ ...form, profitRangeMax: e.target.value })}
                      className="w-full px-4 py-3 bg-white dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-blue-500/20 transition-all outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2 ml-1">Technical Analysis</label>
                  <textarea
                    value={form.analysis}
                    onChange={(e) => setForm({ ...form, analysis: e.target.value })}
                    rows={4}
                    className="w-full px-4 py-3 bg-white dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-blue-500/20 transition-all outline-none"
                  />
                </div>

                <div className="bg-gray-50 dark:bg-slate-800/50 p-6 rounded-2xl border-2 border-dashed border-gray-200 dark:border-slate-700">
                  <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-3">Chart Visualization</label>
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-4 py-2 bg-white dark:bg-slate-700 border-2 border-gray-200 dark:border-slate-600 rounded-xl font-bold text-sm shadow-sm hover:border-blue-500 transition-all"
                    >
                      Choose File
                    </button>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleImageUpload}
                      accept="image/*"
                      className="hidden"
                    />
                    {imageUploading && <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full"></div>}
                  </div>
                  {form.imageUrl && (
                    <div className="mt-4 relative group w-fit">
                      <img src={form.imageUrl} alt="Chart preview" className="max-w-[200px] h-auto rounded-xl border-2 border-gray-100 dark:border-slate-700 shadow-lg" />
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, imageUrl: "" })}
                        className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full p-1.5 shadow-lg hover:bg-red-700 transition-all opacity-0 group-hover:opacity-100"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  )}
                </div>

                <div className="pt-4 flex gap-3 sticky bottom-0 bg-white dark:bg-slate-900 pb-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowModal(false);
                      setEditingId(null);
                      setForm(emptyForm);
                    }}
                    className="flex-1 px-6 py-4 bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 rounded-xl font-bold hover:bg-gray-200 dark:hover:bg-slate-700 transition-all active:scale-95"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 px-6 py-4 bg-blue-600 text-white rounded-xl font-black hover:bg-blue-700 shadow-lg shadow-blue-500/30 transition-all active:scale-95 disabled:opacity-50"
                  >
                    {saving ? "Saving..." : editingId ? "Update" : "Create"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {showImageModal && (
        <div className="fixed inset-0 z-[100] overflow-y-auto">
          <div className="flex min-h-screen items-center justify-center p-4">
            <div className="fixed inset-0 bg-slate-900/95 backdrop-blur-md transition-opacity" onClick={() => setShowImageModal(false)}></div>
            <div className="relative animate-in zoom-in duration-300">
              <img src={selectedImage} alt="Chart preview" className="max-w-full max-h-[90vh] rounded-2xl shadow-2xl border-2 border-slate-800" />
              <button
                onClick={() => setShowImageModal(false)}
                className="absolute -top-4 -right-4 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-full p-3 shadow-2xl hover:scale-110 transition-transform border border-gray-100 dark:border-slate-700"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
