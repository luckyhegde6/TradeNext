'use client';

import dynamic from 'next/dynamic';

const UnifiedChart = dynamic(() => import('../../components/UnifiedChart'), { ssr: false });

export default function ClientChartWrapper({ prices, ticker }: { 
  prices: { trade_date: Date; open?: number; high?: number; low?: number; close: number; volume?: number }[]; 
  ticker: string 
}) {
    return (
        <div>
            <UnifiedChart prices={prices} ticker={ticker} />
        </div>
    );
}
