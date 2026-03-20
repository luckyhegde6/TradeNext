// app/components/seo/StockSchema.tsx
/**
 * Stock/Financial Product Schema for Stock Pages
 * Helps search engines display stock information
 */

interface StockSchemaProps {
  symbol: string;
  companyName: string;
  exchange?: string;
  price?: number;
  currency?: string;
  baseUrl?: string;
}

export function StockSchema({
  symbol,
  companyName,
  exchange = "NSE",
  price,
  currency = "INR",
  baseUrl = "https://tradenext6.netlify.app",
}: StockSchemaProps) {
  const stockData: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "FinancialProduct",
    name: `${companyName} (${symbol})`,
    description: `Real-time stock data for ${companyName} (${symbol}) on ${exchange}`,
    url: `${baseUrl}/company/${symbol}`,
    provider: {
      "@type": "Organization",
      name: "TradeNext",
      url: baseUrl,
    },
  };

  // Add price if available
  if (price !== undefined) {
    stockData.offers = {
      "@type": "Offer",
      price: price.toFixed(2),
      priceCurrency: currency,
      availability: "https://schema.org/InStock",
      seller: {
        "@type": "Organization",
        name: "NSE India",
      },
    };
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(stockData) }}
    />
  );
}

/**
 * Stock Summary Schema for screener/market pages
 */
interface StockSummarySchemaProps {
  stocks: Array<{
    symbol: string;
    companyName: string;
    price?: number;
    change?: number;
  }>;
  baseUrl?: string;
}

export function StockSummarySchema({
  stocks,
  baseUrl = "https://tradenext6.netlify.app",
}: StockSummarySchemaProps) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "NSE Stock Market Data",
    description: "List of stocks available on TradeNext from NSE India",
    numberOfItems: stocks.length,
    itemListElement: stocks.slice(0, 100).map((stock, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "FinancialProduct",
        name: `${stock.companyName} (${stock.symbol})`,
        description: `${stock.companyName} stock on NSE`,
        url: `${baseUrl}/company/${stock.symbol}`,
      },
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export default StockSchema;
