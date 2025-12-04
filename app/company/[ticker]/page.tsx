// app/company/[ticker]/page.tsx
import { notFound } from 'next/navigation';
import ClientChartWrapper from './ClientChartWrapper';
import { getCompanyData } from '@/lib/services/companyService';

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
    if (!data) return notFound();

    return (
        <main style={{ padding: 24 }}>
            <h1>{ticker}</h1>
            <p>Latest fundamentals snapshot:</p>
            <pre>{JSON.stringify(data.fundamentals || {}, null, 2)}</pre>
            <ClientChartWrapper prices={data.prices || []} ticker={ticker} />
        </main>
    );
}
