"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { MARKET_TIMINGS, MARKET_HOLIDAYS } from "@/lib/constants";
import Link from "next/link";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function MarketStatus() {
    const [isOpen, setIsOpen] = useState(false);
    const [message, setMessage] = useState("Checking Market Status...");

    const { data, error } = useSWR("/api/nse/index/NIFTY%2050", fetcher, {
        refreshInterval: 60000,
    });

    useEffect(() => {
        const checkStatus = () => {
            const now = new Date();

            // 1. Check Holiday
            const dateStr = now.toISOString().split("T")[0];
            if (MARKET_HOLIDAYS.includes(dateStr)) {
                setIsOpen(false);
                setMessage("Market Closed (Holiday)");
                return;
            }

            // 2. Check Weekend
            const day = now.getDay();
            if (day === 0 || day === 6) {
                setIsOpen(false);
                setMessage("Market Closed (Weekend)");
                return;
            }

            // 3. Check Time (IST)
            // Convert to IST string HH:MM
            const istTime = now.toLocaleTimeString("en-GB", {
                timeZone: "Asia/Kolkata",
                hour: "2-digit",
                minute: "2-digit",
            });

            if (istTime >= MARKET_TIMINGS.start && istTime <= MARKET_TIMINGS.end) {
                setIsOpen(true);
                setMessage("Market Open");
            } else {
                setIsOpen(false);
                setMessage("Market Closed");
            }
        };

        checkStatus();
        const timer = setInterval(checkStatus, 60000); // Check every minute
        return () => clearInterval(timer);
    }, []);

    // Don't show if there's an error or no data
    if (error || (!isOpen && !data)) return null;

    // Nifty 50 Data Accessors
    const lastPrice = data?.lastPrice ? Number(data.lastPrice).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : "Loading...";
    const pChange = data?.pChange || "0.00";
    const isPositive = parseFloat(pChange) >= 0;

    return (
        <div className="fixed bottom-4 right-4 z-50">
            <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-4 w-64 animate-fade-in-up">
                <div className="flex justify-between items-center mb-2">
                    <h3 className="text-sm font-semibold text-gray-700">NIFTY 50</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${isOpen ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                        {message}
                    </span>
                </div>
                <div className="flex items-baseline space-x-2">
                    <span className="text-2xl font-bold text-gray-900">{lastPrice}</span>
                    <span className={`text-sm font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                        {isPositive ? "+" : ""}{pChange}%
                    </span>
                </div>
                <div className="mt-2 text-xs text-right text-gray-400">
                    <Link href="/markets" className="hover:text-blue-600">View Dashboard &rarr;</Link>
                </div>
            </div>
        </div>
    );
}
