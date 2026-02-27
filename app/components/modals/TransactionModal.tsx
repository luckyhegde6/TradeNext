import { useState, useMemo, useEffect, useCallback } from "react";
import symbolsData from "@/lib/constants/symbols.json";

interface Transaction {
    id: string;
    ticker: string;
    side: string;
    quantity: number;
    price: number;
    tradeDate: string;
    fees: number | null;
    notes: string | null;
}

interface TransactionModalProps {
    portfolioId: string;
    onClose: () => void;
    onUpdate: () => void;
    editingTransaction?: Transaction | null;
}

export default function TransactionModal({ portfolioId, onClose, onUpdate, editingTransaction }: TransactionModalProps) {
    const [ticker, setTicker] = useState("");
    const [searchTerm, setSearchTerm] = useState("");
    const [showDropdown, setShowDropdown] = useState(false);
    const [side, setSide] = useState<"BUY" | "SELL">("BUY");
    const [quantity, setQuantity] = useState("");
    const [price, setPrice] = useState("");
    const [isManualPrice, setIsManualPrice] = useState(false);
    const [fetchingPrice, setFetchingPrice] = useState(false);
    const [tradeDate, setTradeDate] = useState(new Date().toISOString().split('T')[0]);
    const [fees, setFees] = useState("");
    const [notes, setNotes] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (editingTransaction) {
            setTicker(editingTransaction.ticker);
            setSearchTerm(editingTransaction.ticker);
            setSide(editingTransaction.side as "BUY" | "SELL");
            setQuantity(editingTransaction.quantity.toString());
            setPrice(editingTransaction.price.toString());
            setTradeDate(new Date(editingTransaction.tradeDate).toISOString().split('T')[0]);
            setFees(editingTransaction.fees?.toString() || "");
            setNotes(editingTransaction.notes || "");
        }
    }, [editingTransaction]);

    const fetchLivePrice = useCallback(async (symbol: string) => {
        if (!symbol) return;
        try {
            setFetchingPrice(true);
            const res = await fetch(`/api/nse/stock/${symbol}/quote`);
            if (res.ok) {
                const data = await res.json();
                if (data.lastPrice && !isManualPrice) {
                    setPrice(data.lastPrice.toString());
                }
            }
        } catch (err) {
            console.error("Failed to fetch live price:", err);
        } finally {
            setFetchingPrice(false);
        }
    }, [isManualPrice]);

    useEffect(() => {
        if (ticker && !isManualPrice) {
            fetchLivePrice(ticker);
        }
    }, [ticker, isManualPrice, fetchLivePrice]);

    const filteredSymbols = useMemo(() => {
        if (!searchTerm) return [];
        const search = searchTerm.toUpperCase();
        return (symbolsData as { symbol: string; name: string }[])
            .filter(s => s.symbol.includes(search) || s.name.toUpperCase().includes(search))
            .slice(0, 50); // Limit results for performance
    }, [searchTerm]);

    const handleSelectSymbol = (symbol: string) => {
        setTicker(symbol);
        setSearchTerm(symbol);
        setShowDropdown(false);
        setIsManualPrice(false); // Reset to allow auto-fill for new symbol
        if (error.includes("valid symbol")) setError("");
    };

    const handlePriceChange = (val: string) => {
        setPrice(val);
        setIsManualPrice(true); // Stop auto-refill once user edits
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validate ticker
        const isValid = (symbolsData as { symbol: string }[]).some(s => s.symbol === ticker.toUpperCase());
        if (!isValid) {
            setError("Please select a valid symbol from the list");
            return;
        }

        setLoading(true);
        setError("");

        const payload = {
            ticker: ticker.toUpperCase(),
            side,
            quantity: parseFloat(quantity),
            price: parseFloat(price),
            tradeDate: new Date(tradeDate).toISOString(),
            fees: fees ? parseFloat(fees) : 0,
            notes,
        };

        try {
            const url = editingTransaction 
                ? `/api/user/holdings?id=${editingTransaction.id}` 
                : '/api/user/holdings';
            const method = editingTransaction ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                onUpdate();
                onClose();
            } else {
                const data = await res.json();
                setError(data.error || (editingTransaction ? "Failed to update transaction" : "Failed to add transaction"));
            }
        } catch (err) {
            setError("An unexpected error occurred");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-6 relative border border-gray-200 dark:border-slate-800">
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 text-center">Add Transaction</h2>

                {error && (
                    <div className="mb-4 p-3 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-sm">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="relative">
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Ticker</label>
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => {
                                    setSearchTerm(e.target.value);
                                    setShowDropdown(true);
                                    if (!e.target.value) setTicker("");
                                }}
                                onFocus={() => setShowDropdown(true)}
                                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                placeholder="Search Symbol..."
                                required
                            />
                            {showDropdown && filteredSymbols.length > 0 && (
                                <div className="absolute z-[110] left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-xl">
                                    {filteredSymbols.map(s => (
                                        <button
                                            key={s.symbol}
                                            type="button"
                                            onClick={() => handleSelectSymbol(s.symbol)}
                                            className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-slate-700 border-b border-gray-100 dark:border-slate-700 last:border-0 transition-colors"
                                        >
                                            <div className="font-bold text-sm text-gray-900 dark:text-white">{s.symbol}</div>
                                            <div className="text-xs text-gray-500 dark:text-slate-400 truncate">{s.name}</div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Side</label>
                            <select
                                value={side}
                                onChange={(e) => setSide(e.target.value as "BUY" | "SELL")}
                                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                            >
                                <option value="BUY">BUY</option>
                                <option value="SELL">SELL</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Quantity</label>
                            <input
                                type="number"
                                step="any"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                placeholder="0.00"
                                required
                            />
                        </div>
                        <div className="relative">
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1 flex justify-between">
                                Price
                                {fetchingPrice && <span className="text-[10px] animate-pulse text-blue-500">Fetching...</span>}
                                {!isManualPrice && price && !fetchingPrice && <span className="text-[10px] text-green-500 font-bold px-1.5 py-0.5 bg-green-50 dark:bg-green-900/20 rounded">LIVE</span>}
                            </label>
                            <input
                                type="number"
                                step="any"
                                value={price}
                                onChange={(e) => handlePriceChange(e.target.value)}
                                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                placeholder="0.00"
                                required
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Trade Date</label>
                            <input
                                type="date"
                                value={tradeDate}
                                onChange={(e) => setTradeDate(e.target.value)}
                                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Fees (Optional)</label>
                            <input
                                type="number"
                                step="any"
                                value={fees}
                                onChange={(e) => setFees(e.target.value)}
                                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                placeholder="0.00"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Notes</label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                            placeholder="Add any notes..."
                            rows={2}
                        />
                    </div>

                    <div className="flex gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-3 px-4 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 font-semibold rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-all active:scale-95"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className={`flex-1 py-3 px-4 font-semibold rounded-lg transition-all shadow-lg active:scale-95 disabled:opacity-50 ${side === 'BUY' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-red-600 text-white hover:bg-red-700'
                                }`}
                        >
                            {loading ? "Processing..." : `Add ${side} Transaction`}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
