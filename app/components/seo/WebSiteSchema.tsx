// app/components/seo/WebSiteSchema.tsx
/**
 * WebSite Schema for Structured Data
 * Includes SearchAction for site search functionality
 */

interface WebSiteSchemaProps {
  baseUrl?: string;
}

export function WebSiteSchema({ baseUrl = "https://tradenext6.netlify.app" }: WebSiteSchemaProps) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${baseUrl}/#website`,
    url: baseUrl,
    name: "TradeNext - Smart NSE Analytics & Portfolio Manager",
    description: "Comprehensive NSE stock market data, portfolio management, corporate actions, and advanced analytics for Indian investors.",
    publisher: {
      "@id": `${baseUrl}/#organization`,
    },
    potentialAction: [
      {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${baseUrl}/search?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
      {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${baseUrl}/markets/screener?symbol={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    ],
    inLanguage: "en-IN",
    isAccessibleForFree: "True",
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export default WebSiteSchema;
