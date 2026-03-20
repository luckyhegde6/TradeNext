// app/news/metadata.ts
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Stock Market News | TradeNext - NSE India",
  description:
    "Latest stock market news and financial news from India and around the world. Stay updated with real-time market news, company announcements, and economic updates.",
  keywords: [
    "stock market news",
    "NSE news",
    "market news India",
    "financial news",
    "company news",
    "stock news",
    "business news",
    "economic news",
    "market updates",
  ],
  openGraph: {
    title: "Stock Market News | TradeNext",
    description: "Latest stock market news and financial news from India and around the world",
    url: "https://tradenext6.netlify.app/news",
    type: "website",
    siteName: "TradeNext",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stock Market News | TradeNext",
    description: "Latest stock market news and financial news",
  },
};

export default metadata;
