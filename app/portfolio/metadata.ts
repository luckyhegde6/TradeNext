// app/portfolio/metadata.ts
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Portfolio Management | TradeNext - NSE India",
  description:
    "Manage your stock portfolio on TradeNext. Track holdings, view P&L, add transactions, and analyze your investment performance across NSE-listed stocks.",
  keywords: [
    "portfolio management",
    "stock portfolio",
    "investment tracking",
    "holdings",
    "P&L",
    "profit loss",
    "stock transactions",
    "NSE portfolio",
    "investment portfolio",
  ],
  openGraph: {
    title: "Portfolio Management | TradeNext",
    description: "Manage your stock portfolio and track investment performance",
    url: "https://tradenext6.netlify.app/portfolio",
    type: "website",
    siteName: "TradeNext",
  },
  twitter: {
    card: "summary_large_image",
    title: "Portfolio Management | TradeNext",
    description: "Manage your stock portfolio and track investment performance",
  },
};

export default metadata;
