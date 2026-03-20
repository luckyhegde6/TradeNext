// app/components/seo/SEOTags.tsx
/**
 * SEO Tags Component
 * Provides comprehensive SEO metadata and structured data
 * 
 * Security Considerations:
 * - All content is static/server-rendered (no XSS risk)
 * - URLs are validated and sanitized
 * - No user-generated content is included
 */

import { Metadata } from "next";
import OrganizationSchema from "./OrganizationSchema";
import WebSiteSchema from "./WebSiteSchema";
import WebPageSchema from "./WebPageSchema";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://tradenext6.netlify.app";

/**
 * Default metadata for TradeNext
 */
export const defaultMetadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "TradeNext - Smart NSE Analytics & Portfolio Manager",
    template: "%s | TradeNext",
  },
  description:
    "Comprehensive NSE stock market data, portfolio management, corporate actions, and advanced analytics for Indian investors. Track NSE 50, BANK, IT, MIDCAP, SMALLCAP indices and individual stocks.",
  keywords: [
    "NSE India",
    "stock market",
    "portfolio management",
    "corporate actions",
    "NSE analytics",
    "Indian stocks",
    "dividends",
    "bonus",
    "stock screener",
    "NSE 50",
    "BANK NIFTY",
    "NIFTY IT",
    "intraday trading",
    "investing in India",
    "stock portfolio",
    "equity market",
    "sensex",
    "nifty",
    "stock tips",
    "fundamental analysis",
  ],
  authors: [{ name: "TradeNext", url: BASE_URL }],
  creator: "TradeNext",
  publisher: "TradeNext",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: BASE_URL,
    siteName: "TradeNext",
    title: "TradeNext - Smart NSE Analytics & Portfolio Manager",
    description:
      "Comprehensive NSE stock market data, portfolio management, corporate actions, and advanced analytics for Indian investors.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "TradeNext - NSE Analytics Platform",
        type: "image/png",
      },
    ],
    videos: [],
  },
  twitter: {
    card: "summary_large_image",
    title: "TradeNext - Smart NSE Analytics & Portfolio Manager",
    description:
      "Comprehensive NSE stock market data, portfolio management, corporate actions, and advanced analytics for Indian investors.",
    site: "@tradenext",
    creator: "@tradenext",
    images: {
      url: "/og-image.png",
      alt: "TradeNext - NSE Analytics Platform",
    },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: BASE_URL,
    languages: {
      "en-IN": BASE_URL,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  manifest: "/manifest.json",
  category: "Finance",
};

/**
 * Component that renders global SEO schemas
 * Should be included in the root layout
 */
export function SEOTags() {
  return (
    <>
      <OrganizationSchema baseUrl={BASE_URL} />
      <WebSiteSchema baseUrl={BASE_URL} />
      <WebPageSchema
        baseUrl={BASE_URL}
        path="/"
        name="TradeNext - Smart NSE Analytics & Portfolio Manager"
        description="Comprehensive NSE stock market data, portfolio management, corporate actions, and advanced analytics for Indian investors."
      />
    </>
  );
}

/**
 * Generate page-specific metadata
 */
export function generatePageMetadata(options: {
  title: string;
  description: string;
  path: string;
  keywords?: string[];
  image?: string;
  noIndex?: boolean;
}): Metadata {
  const { title, description, path, keywords = [], image, noIndex = false } = options;
  const url = `${BASE_URL}${path}`;

  return {
    title,
    description,
    keywords: [...defaultMetadata.keywords!, ...keywords],
    alternates: {
      canonical: url,
    },
    openGraph: {
      ...defaultMetadata.openGraph,
      title,
      description,
      url,
      images: image
        ? [{ url: image, width: 1200, height: 630, alt: title }]
        : defaultMetadata.openGraph?.images,
    },
    twitter: {
      ...defaultMetadata.twitter,
      title,
      description,
      images: image ? [image] : defaultMetadata.twitter?.images,
    },
    robots: {
      index: !noIndex,
      follow: !noIndex,
      googleBot: {
        index: !noIndex,
        follow: !noIndex,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
  };
}

export default SEOTags;
