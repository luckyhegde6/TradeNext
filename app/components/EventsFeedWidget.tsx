"use client";

// app/components/EventsFeedWidget.tsx
//
// NSE events / notifications feed (listing ceremonies, webinars…) with
// thumbnails. Rendered below Corporate Announcements on the dashboard;
// grid auto-fits the available width (responsive, dynamic sizing) and the
// list scrolls inside a fixed-height column so the page stays balanced.

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import type { NseEvent } from "@/lib/services/nseEventsService";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

interface EventsResponse {
  success?: boolean;
  events?: NseEvent[];
}

export default function EventsFeedWidget() {
  const { data, isLoading } = useSWR<EventsResponse>("/api/events", fetcher, {
    refreshInterval: 10 * 60 * 1000, // 10 min — NSE events change slowly
  });
  const [imageError, setImageError] = useState<Record<number, boolean>>({});

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-950">
          <h3 className="font-bold text-base text-gray-900 dark:text-white flex items-center gap-2">
            🎉 NSE Events
          </h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-40 bg-gray-100 dark:bg-slate-800 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  const events = data?.events ?? [];

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-950 flex items-center justify-between">
        <h3 className="font-bold text-base text-gray-900 dark:text-white flex items-center gap-2">
          🎉 NSE Events
        </h3>
        {events.length > 0 && (
          <span className="text-xs text-gray-500 dark:text-slate-400">({events.length})</span>
        )}
      </div>

      {/* Dynamic sizing: auto-fill grid that adapts to the column width */}
      <div
        className="flex-1 overflow-y-auto max-h-80 grid gap-3 p-4"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          alignContent: "start",
        }}
      >
        {events.map((ev) => (
          <article
            key={ev.id}
            className="group flex flex-col rounded-lg border border-gray-200 dark:border-slate-800 overflow-hidden hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 transition-all bg-white dark:bg-slate-900"
          >
            {ev.thumbnailUrl && !imageError[ev.id] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ev.thumbnailUrl}
                alt={ev.title}
                loading="lazy"
                onError={() => setImageError((m) => ({ ...m, [ev.id]: true }))}
                className="w-full aspect-[3/2] object-cover"
              />
            ) : (
              <div className="w-full aspect-[3/2] bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center text-3xl">
                {ev.categoryName === "Listing Ceremony" ? "🏛️" : "🎉"}
              </div>
            )}
            <div className="p-3 flex-1 flex flex-col">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${
                    ev.dateLabel === "PAST"
                      ? "bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400"
                      : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                  }`}
                >
                  {ev.dateLabel === "PAST" ? "Past" : "Upcoming"}
                </span>
                <span className="text-[10px] text-gray-400">{formatDate(ev.eventDate)}</span>
              </div>
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                {ev.title}
              </h4>
              {ev.slugUrl && (
                <Link
                  href={`https://www.nseindia.com${ev.slugUrl}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-auto pt-2 text-xs text-blue-500 hover:underline inline-block"
                >
                  View event →
                </Link>
              )}
            </div>
          </article>
        ))}

        {events.length === 0 && (
          <div className="col-span-full p-6 text-center text-gray-400 text-sm">
            No events available right now.
          </div>
        )}
      </div>
    </div>
  );
}