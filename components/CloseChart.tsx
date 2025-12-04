// components/CloseChart.tsx
'use client';
import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';

export default function CloseChart({ prices, ticker }: { prices: { trade_date: Date; close: number }[], ticker: string }) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    useEffect(() => {
        if (!canvasRef.current) return;
        const labels = prices.map(p => new Date(p.trade_date).toISOString().slice(0, 10)).reverse();
        const data = prices.map(p => p.close).reverse();
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;
        const chart = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets: [{ label: `${ticker} Close`, data }] },
        });
        return () => chart.destroy();
    }, [prices, ticker]);

    return <canvas ref={canvasRef} width={600} height={300} />;
}
