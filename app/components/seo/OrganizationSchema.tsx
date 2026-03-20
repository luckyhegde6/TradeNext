// app/components/seo/OrganizationSchema.tsx
/**
 * Organization Schema for Structured Data
 * Helps search engines understand your organization
 */

interface OrganizationSchemaProps {
  baseUrl?: string;
}

export function OrganizationSchema({ baseUrl = "https://tradenext6.netlify.app" }: OrganizationSchemaProps) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${baseUrl}/#organization`,
    name: "TradeNext",
    url: baseUrl,
    logo: {
      "@type": "ImageObject",
      url: `${baseUrl}/logo.png`,
      width: 200,
      height: 60,
    },
    description: "Smart NSE Analytics & Portfolio Manager for Indian investors. Track NSE stocks, manage portfolios, and analyze corporate actions.",
    foundingDate: "2026",
    industry: "Financial Services",
    knowsAbout: [
      "Stock Market",
      "NSE India",
      "Portfolio Management",
      "Corporate Actions",
      "Dividends",
      "Stock Analysis",
    ],
    areaServed: {
      "@type": "Country",
      name: "India",
    },
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "Customer Support",
      availableLanguage: ["English", "Hindi"],
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export default OrganizationSchema;
