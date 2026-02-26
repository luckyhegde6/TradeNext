// app/company/[ticker]/page.tsx
import { notFound } from 'next/navigation';
import DynamicChartWrapper from './DynamicChartWrapper';
import { getCompanyData } from '@/lib/services/companyService';
import StockQuoteHeader from '@/app/components/StockQuoteHeader';
import NSEStockChart from '@/app/components/NSEStockChart';
import CorporateDataTabs from '@/app/components/analytics/CorporateDataTabs';
import PiotroskiFScore from '@/app/components/analytics/PiotroskiFScore';

async function getCompany(ticker: string) {
    try {
        return await getCompanyData(ticker);
    } catch (error) {
        console.error('Error fetching company data:', error);
        return null;
    }
}

export default async function CompanyPage({ params }: { params: Promise<{ ticker: string }> }) {
    const { ticker: tickerParam } = await params;
    const ticker = tickerParam.toUpperCase();
    const data = await getCompany(ticker);

    // Don't require database data - NSE components will work independently
    if (!data) return notFound();

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-slate-950 p-6">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* NSE Stock Quote Header */}
                <StockQuoteHeader symbol={ticker} />

                {/* NSE Real-time Chart */}
                <NSEStockChart symbol={ticker} />

                {/* Corporate Data (Financials, Events, Announcements, Actions) */}
                <div className="space-y-4">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white px-1">Corporate Updates</h3>
                    <CorporateDataTabs symbol={ticker} />
                </div>

                {/* Piotroski F-Score */}
                <PiotroskiFScore symbol={ticker} />

                {/* Technical Indicators Chart - Dynamically loads from NSE API */}
                <DynamicChartWrapper ticker={ticker} dbPrices={data?.prices} />

                {/* Fundamentals (if available) */}
                {data?.fundamentals && (
                    <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Fundamentals</h3>
                        <pre className="text-sm text-gray-700 dark:text-gray-300 overflow-auto">
                            {JSON.stringify(data.fundamentals, null, 2)}
                        </pre>
                    </div>
                )}
            </div>
        </div>
    );
}
