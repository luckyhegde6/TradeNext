// app/alerts/metadata.ts
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Price Alerts | TradeNext - NSE India",
  description:
    "Set price alerts for NSE stocks and get notified when your target prices are reached. Track stock price movements and receive alerts for price above, below, or percentage change.",
  keywords: [
    "price alerts",
    "stock alerts",
    "NSE alerts",
    "price notifications",
    "stock monitoring",
    "alert system",
    "target price",
    "price tracking",
  ],
  openGraph: {
    title: "Price Alerts | TradeNext",
    description: "Set price alerts for NSE stocks and get notified when targets are reached",
    url: "https://tradenext6.netlify.app/alerts",
    type: "website",
    siteName: "TradeNext",
  },
  twitter: {
    card: "summary_large_image",
    title: "Price Alerts | TradeNext",
    description: "Set price alerts for NSE stocks",
  },
};

export default metadata;
