"use client";

import { useState, useEffect, useRef } from "react";

interface Symbol {
    symbol: string;
    companyName: string;
}

interface AutocompleteProps {
    onSelect: (symbol: string) => void;
    placeholder?: string;
    initialValue?: string;
    className?: string;
}

export default function Autocomplete({ onSelect, placeholder = "Search symbol...", initialValue = "", className = "" }: AutocompleteProps) {
    const [query, setQuery] = useState(initialValue);
    const [results, setResults] = useState<Symbol[]>([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [loading, setLoading] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        const fetchSymbols = async () => {
            if (query.trim().length < 1) {
                setResults([]);
                return;
            }

            setLoading(true);
            try {
                const response = await fetch(`/api/symbols/search?q=${encodeURIComponent(query)}`);
                if (response.ok) {
                    const data = await response.json();
                    setResults(data.symbols || []);
                }
            } catch (err) {
                console.error("Autocomplete fetch error:", err);
            } finally {
                setLoading(false);
            }
        };

        const timeoutId = setTimeout(fetchSymbols, 300);
        return () => clearTimeout(timeoutId);
    }, [query]);

    const handleSelect = (symbol: string) => {
        setQuery(symbol);
        onSelect(symbol);
        setShowDropdown(false);
    };

    return (
        <div className={`relative ${className}`} ref={dropdownRef}>
            <input
                type="text"
                value={query}
                onChange={(e) => {
                    setQuery(e.target.value.toUpperCase());
                    setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                placeholder={placeholder}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 dark:text-white"
                autoFocus
            />
            {showDropdown && (query.length > 0 || results.length > 0) && (
                <div className="absolute z-[60] left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-md shadow-lg">
                    {loading && results.length === 0 && (
                        <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">Searching...</div>
                    )}
                    {!loading && results.length === 0 && query.length > 0 && (
                        <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">No results found</div>
                    )}
                    {results.map((result) => (
                        <button
                            key={result.symbol}
                            type="button"
                            onClick={() => handleSelect(result.symbol)}
                            className="w-full text-left px-4 py-2 hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors border-b border-gray-100 dark:border-slate-800 last:border-0"
                        >
                            <div className="font-bold text-gray-900 dark:text-white">{result.symbol}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{result.companyName}</div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
