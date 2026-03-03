"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";

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
}

interface SubscribedRecommendation {
  id: string;
  recommendationId: string;
  userId: number;
  createdAt: string;
  recommendation?: StockRecommendation;
}

export default function RecommendationsPage() {
  const { data: session, status } = useSession();
  const [recommendations, setRecommendations] = useState<StockRecommendation[]>([]);
  const [subscribedIds, setSubscribedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>("all");
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string>("");

  useEffect(() => {
    if (status === "authenticated") {
      fetchRecommendations();
      fetchSubscriptions();
    }
  }, [status]);

  const fetchRecommendations = async () => {
    try {
      const response = await fetch("/api/user/recommendations");
      if (response.ok) {
        const data = await response.json();
        setRecommendations(data);
      }
    } catch (err) {
      console.error("Failed to fetch recommendations:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSubscriptions = async () => {
    try {
      const response = await fetch("/api/user/subscriptions");
      if (response.ok) {
        const data = await response.json();
        const subscribed = new Set<string>(data.subscriptions?.map((s: SubscribedRecommendation) => s.recommendationId) || []);
        setSubscribedIds(subscribed);
      }
    } catch (err) {
      console.error("Failed to fetch subscriptions:", err);
    }
  };

  const handleSubscribe = async (recommendationId: string) => {
    setSubscribing(recommendationId);
    try {
      const method = subscribedIds.has(recommendationId) ? "DELETE" : "POST";
      const response = await fetch("/api/user/subscriptions", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendationId }),
      });

      if (response.ok) {
        const newSubscribed = new Set(subscribedIds);
        if (subscribedIds.has(recommendationId)) {
          newSubscribed.delete(recommendationId);
        } else {
          newSubscribed.add(recommendationId);
        }
        setSubscribedIds(newSubscribed);
      }
    } catch (err) {
      console.error("Failed to subscribe:", err);
    } finally {
      setSubscribing(null);
    }
  };

  const filteredRecommendations = useMemo(() => {
    let result = [...recommendations];
    if (filterType !== "all") {
      result = result.filter((r) => r.recommendation === filterType);
    }
    return result;
  }, [recommendations, filterType]);

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

  const openImageModal = (imageUrl: string) => {
    setSelectedImage(imageUrl);
    setShowImageModal(true);
  };

  if (status === "loading" || loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Stock Recommendations</h1>
        <div className="animate-pulse space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-gray-200 dark:bg-slate-800 h-32 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Stock Recommendations</h1>
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-8 text-center">
          <p className="text-gray-600 dark:text-gray-400">Please sign in to view stock recommendations.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Stock Recommendations</h1>
        <p className="text-gray-600 dark:text-gray-400">
          {subscribedIds.size} subscription{subscribedIds.size !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{recommendations.length}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Buy</p>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">
            {recommendations.filter((r) => r.recommendation === "BUY" || r.recommendation === "ACCUMULATE").length}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Sell</p>
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">
            {recommendations.filter((r) => r.recommendation === "SELL").length}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Hold</p>
          <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
            {recommendations.filter((r) => r.recommendation === "HOLD").length}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Neutral</p>
          <p className="text-2xl font-bold text-gray-600 dark:text-gray-400">
            {recommendations.filter((r) => r.recommendation === "NEUTRAL").length}
          </p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 shadow overflow-hidden sm:rounded-md">
        <div className="px-4 py-4 sm:px-6 border-b border-gray-200 dark:border-slate-700">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-white">
              Active Recommendations ({filteredRecommendations.length})
            </h3>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 dark:text-white"
            >
              <option value="all">All Types</option>
              <option value="BUY">BUY</option>
              <option value="ACCUMULATE">ACCUMULATE</option>
              <option value="HOLD">HOLD</option>
              <option value="SELL">SELL</option>
              <option value="NEUTRAL">NEUTRAL</option>
            </select>
          </div>
        </div>

        <ul className="divide-y divide-gray-200 dark:divide-slate-800">
          {filteredRecommendations.map((rec) => (
            <li key={rec.id} className="px-4 py-4 sm:px-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center space-x-3">
                    <a
                      href={`/company/${rec.symbol}`}
                      className="text-lg font-bold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {rec.symbol}
                    </a>
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getRecommendationColor(rec.recommendation)}`}>
                      {rec.recommendation}
                    </span>
                    {subscribedIds.has(rec.id) && (
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-300">
                        Subscribed
                      </span>
                    )}
                  </div>
                  
                  <div className="mt-2 sm:flex sm:justify-between">
                    <div className="sm:flex space-x-6 text-sm text-gray-500 dark:text-gray-400">
                      {rec.targetPrice && <span>Target: ₹{rec.targetPrice}</span>}
                      {rec.entryRange && <span>Entry: {rec.entryRange}</span>}
                      {rec.profitRangeMin && rec.profitRangeMax && (
                        <span>Profit: ₹{rec.profitRangeMin} - ₹{rec.profitRangeMax}</span>
                      )}
                      {rec.analystRating && <span>Rating: {rec.analystRating}</span>}
                    </div>
                    <div className="mt-2 sm:mt-0 text-sm text-gray-500 dark:text-gray-400">
                      <span>{new Date(rec.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>

                  {rec.analysis && (
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 line-clamp-3">{rec.analysis}</p>
                  )}

                  {(rec.shortTerm || rec.longTerm || rec.intraday) && (
                    <div className="mt-2 flex gap-4 text-xs text-gray-500 dark:text-gray-400">
                      {rec.shortTerm && <span>Short Term: {rec.shortTerm}</span>}
                      {rec.longTerm && <span>Long Term: {rec.longTerm}</span>}
                      {rec.intraday && <span>Intraday: {rec.intraday}</span>}
                    </div>
                  )}

                  {rec.imageUrl && (
                    <div className="mt-2">
                      <img 
                        src={rec.imageUrl} 
                        alt="Chart" 
                        className="max-w-xs rounded border dark:border-slate-600 cursor-pointer hover:opacity-80"
                        onClick={() => openImageModal(rec.imageUrl!)}
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                  <button
                    onClick={() => handleSubscribe(rec.id)}
                    disabled={subscribing === rec.id}
                    className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                      subscribedIds.has(rec.id)
                        ? "bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-slate-600"
                        : "bg-blue-600 text-white hover:bg-blue-700"
                    } disabled:opacity-50`}
                  >
                    {subscribing === rec.id ? "..." : subscribedIds.has(rec.id) ? "Unsubscribe" : "Subscribe"}
                  </button>
                  <a
                    href={`/company/${rec.symbol}`}
                    className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    View Details →
                  </a>
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
      </div>

      {showImageModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-screen items-center justify-center p-4">
            <div className="fixed inset-0 bg-black bg-opacity-75" onClick={() => setShowImageModal(false)}></div>
            <div className="relative">
              <img src={selectedImage} alt="Chart preview" className="max-w-full max-h-[90vh] rounded-lg" />
              <button
                onClick={() => setShowImageModal(false)}
                className="absolute top-2 right-2 bg-white dark:bg-slate-800 rounded-full p-2 hover:bg-gray-100 dark:hover:bg-slate-700"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
