// app/markets/screener/metadata.ts
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Stock Screener | TradeNext - NSE India",
  description:
    "Filter and find NSE stocks by sector, market cap, P/E ratio, volume, dividend yield, and more. Advanced stock screening with live TradingView data.",
  keywords: [
    "stock screener",
    "NSE stocks",
    "filter stocks",
    "NSE India",
    "equity screening",
    "stock filter",
    "market cap filter",
    "P/E ratio filter",
    "volume filter",
    "Nifty stocks",
  ],
  openGraph: {
    title: "Stock Screener | TradeNext",
    description:
      "Filter NSE stocks with advanced criteria including sector, market cap, P/E ratio, volume, and more.",
    url: "https://tradenext6.netlify.app/markets/screener",
    type: "website",
    siteName: "TradeNext",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stock Screener | TradeNext",
    description: "Filter NSE stocks with advanced criteria",
  },
};

export default metadata;
