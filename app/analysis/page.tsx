"use client";
import Tabs from "@/components/Tabs";
import MarketTable from "@/components/MarketTable";

const tabs = [
  { key: "advance", label: "Advances / Declines", url: "/api/nse/advance-decline" },
  { key: "dividend", label: "Dividends", url: "/api/nse/corporate-info" },
  { key: "deals", label: "Bulk Deals", url: "/api/nse/deals" },
  { key: "active", label: "Most Active", url: "/api/nse/deals" },
  { key: "gainers", label: "Top Gainers", url: "/api/nse/gainers" },
  { key: "losers", label: "Top Losers", url: "/api/nse/losers" },
];

export default function MarketsPage() {
  return <Tabs tabs={tabs} />;
}
