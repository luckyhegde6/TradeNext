"use client";
import useSWR from "swr";

export default function MarqueeBanner() {
  const { data, error, isLoading } = useSWR("/api/nse/marquee", (url) => fetch(url).then(r => r.json()));

  if (error) return null;
  if (!data || !Array.isArray(data?.MarqueData) || data.MarqueData.length === 0) return null;
  // MarqueData is expected array of objects with .Text property
  return (
    <div className="bg-yellow-100 dark:bg-yellow-900 text-yellow-900 dark:text-yellow-100 py-2 shadow-inner w-full whitespace-nowrap overflow-hidden">
      <marquee className="px-2 font-medium">
        {data.MarqueData.map((item: any, idx: number) => (
          <span key={idx} className="mx-4 inline-block">
            {item.Text}
          </span>
        ))}
      </marquee>
    </div>
  );
}

