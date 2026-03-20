// app/markets/metadata.ts
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "NSE India Market Overview | TradeNext",
  description:
    "Real-time NSE India market data for NIFTY 50, BANK NIFTY, NIFTY IT, MIDCAP NIFTY, SMALLCAP NIFTY, NIFTY AUTO, and NIFTY PHARMA. Track index performance, market trends, and sector-wise analysis.",
  keywords: [
    "NSE India",
    "NIFTY 50",
    "BANK NIFTY",
    "NIFTY IT",
    "MIDCAP",
    "SMALLCAP",
    "NIFTY AUTO",
    "NIFTY PHARMA",
    "NSE indices",
    "market overview",
    "stock market India",
    "index performance",
  ],
  openGraph: {
    title: "NSE India Market Overview | TradeNext",
    description:
      "Real-time NSE India market data for NIFTY 50, BANK NIFTY, NIFTY IT, and more.",
    url: "https://tradenext6.netlify.app/markets",
    type: "website",
    siteName: "TradeNext",
  },
  twitter: {
    card: "summary_large_image",
    title: "NSE India Market Overview | TradeNext",
    description: "Real-time NSE India market data and index performance",
  },
};

export default metadata;
