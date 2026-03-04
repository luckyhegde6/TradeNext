import { PrismaClient } from '@prisma/client';
import { nseFetch } from '../lib/nse-client';

const prisma = new PrismaClient();

async function main() {
    console.log("Fetching NIFTY TOTAL MARKET symbols from NSE...");
    try {
        const response = await nseFetch('/api/equity-stockIndices?index=NIFTY%20TOTAL%20MARKET');

        if (!response || !response.data || !Array.isArray(response.data)) {
            console.error("Invalid response from NSE API:", response);
            return;
        }

        const symbols = response.data;
        console.log(`Found ${symbols.length} symbols. Upserting into database...`);

        let upsertedCount = 0;
        let errorCount = 0;

        for (const item of symbols) {
            // Skip the index itself if it's in the data
            if (item.symbol === 'NIFTY TOTAL MARKET') {
                continue;
            }

            try {
                const symbol = item.symbol;
                const companyName = item.meta?.companyName || item.symbol;
                const industry = item.meta?.industry || null;
                const series = item.meta?.activeSeries?.[0] || item.series || 'EQ';

                await prisma.symbol.upsert({
                    where: { symbol: symbol },
                    update: {
                        companyName: companyName,
                        industry: industry,
                        series: series,
                        isActive: true,
                    },
                    create: {
                        symbol: symbol,
                        companyName: companyName,
                        industry: industry,
                        series: series,
                        isActive: true,
                    }
                });
                upsertedCount++;
            } catch (error) {
                console.error(`Failed to upsert symbol ${item.symbol}:`, error);
                errorCount++;
            }
        }

        console.log(`\nFinished processing symbols.`);
        console.log(`Successfully upserted: ${upsertedCount}`);
        if (errorCount > 0) {
            console.log(`Errors encountered: ${errorCount}`);
        }
    } catch (error) {
        console.error("Error fetching or processing symbols:", error);
    } finally {
        await prisma.$disconnect();
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
