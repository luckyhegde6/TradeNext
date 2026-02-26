'use client';

import dynamic from 'next/dynamic';

const UnifiedChart = dynamic(() => import('../../components/UnifiedChart'), { ssr: false });

export default function ClientChartWrapper({ prices, ticker }: { 
  prices: { trade_date: Date; open?: number; high?: number; low?: number; close: number; volume?: number }[]; 
  ticker: string 
}) {
    const normalizedPrices = prices.map(p => ({
        trade_date: p.trade_date,
        open: p.open ?? 0,
        high: p.high ?? p.close,
        low: p.low ?? p.close,
        close: p.close,
        volume: p.volume ?? 0
    }));
    
    return (
        <div>
            <UnifiedChart prices={normalizedPrices} ticker={ticker} />
        </div>
    );
}
