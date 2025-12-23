"use client";
import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function MarketTable({ url }: { url: string }) {
  const { data, error } = useSWR(url, fetcher);

  if (error) return <p>Error loading data</p>;
  if (!data) return <p>Loading...</p>;

  return (
    <pre className="text-xs bg-gray-50 p-3 rounded">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
