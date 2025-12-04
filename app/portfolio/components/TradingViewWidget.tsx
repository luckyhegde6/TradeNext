"use client";

import { useEffect, useRef } from 'react';

interface TradingViewWidgetProps {
    symbol: string;
}

export default function TradingViewWidget({ symbol }: TradingViewWidgetProps) {
    const container = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!container.current) return;

        // Store ref value to use in cleanup
        const containerElement = container.current;

        // Clear previous widget
        containerElement.innerHTML = '';

        const script = document.createElement('script');
        script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
        script.type = 'text/javascript';
        script.async = true;
        script.innerHTML = JSON.stringify({
            autosize: true,
            symbol: `NSE:${symbol}`,
            interval: 'D',
            timezone: 'Asia/Kolkata',
            theme: 'dark',
            style: '1',
            locale: 'en',
            enable_publishing: false,
            allow_symbol_change: true,
            support_host: 'https://www.tradingview.com',
        });

        containerElement.appendChild(script);

        return () => {
            containerElement.innerHTML = '';
        };
    }, [symbol]);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden">
            <div className="p-4 border-b border-gray-200 dark:border-slate-800">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    {symbol} Chart
                </h2>
            </div>
            <div className="tradingview-widget-container" ref={container} style={{ height: '500px' }}>
                <div className="tradingview-widget-container__widget"></div>
            </div>
        </div>
    );
}
