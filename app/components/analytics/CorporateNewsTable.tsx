"use client";

import Link from "next/link";

interface CorporateNews {
  symbol: string;
  companyName: string;
  announcementType: string;
  desc: string;
  broadcastDate: string;
  attachmentPath: string;
}

interface Props {
  data: CorporateNews[];
}

export function CorporateNewsTable({ data }: Props) {
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "-";
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No corporate news available
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data.map((news, idx) => (
        <div
          key={idx}
          className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-4 hover:shadow-md transition-shadow"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <Link
                  href={`/company/${news.symbol}`}
                  className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-semibold"
                >
                  {news.symbol}
                </Link>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {news.companyName}
                </span>
              </div>
              <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                {news.announcementType || "Corporate Announcement"}
              </h4>
              <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
                {news.desc}
              </p>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              {formatDate(news.broadcastDate)}
            </div>
          </div>
          {news.attachmentPath && (
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
              <a
                href={news.attachmentPath}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 5.656-5.656l-6.415 6.5850 00-a6 6 0 108.486 8.486L20.5 13" />
                </svg>
                View Attachment
              </a>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
