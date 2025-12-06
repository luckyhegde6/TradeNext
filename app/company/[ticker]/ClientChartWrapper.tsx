'use client';

import dynamic from 'next/dynamic';

const ChartClient = dynamic(() => import('../../components/CloseChart'), { ssr: false });

export default function ClientChartWrapper({ prices, ticker }: { prices: { trade_date: Date; close: number }[]; ticker: string }) {
    return <ChartClient prices={prices} ticker={ticker} />;
}
