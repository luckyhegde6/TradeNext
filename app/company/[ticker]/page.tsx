// app/company/[ticker]/page.tsx
import { notFound } from 'next/navigation';
import ClientChartWrapper from './ClientChartWrapper';
import { getCompanyData } from '@/lib/services/companyService';
import StockQuoteHeader from '@/app/components/StockQuoteHeader';
import NSEStockChart from '@/app/components/NSEStockChart';

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
    // if (!data) return notFound();

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-slate-950 p-6">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* NSE Stock Quote Header */}
                <StockQuoteHeader symbol={ticker} />

                {/* NSE Real-time Chart */}
                <NSEStockChart symbol={ticker} />

                {/* Historical Data from DB (if available) */}
                {data?.prices && data.prices.length > 0 && (
                    <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Historical Performance (Database)</h3>
                        <ClientChartWrapper prices={data.prices} ticker={ticker} />
                    </div>
                )}

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
