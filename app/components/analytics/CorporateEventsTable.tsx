'use client';

import Link from 'next/link';

interface CorporateEvent {
  symbol: string;
  companyName: string;
  purpose: string;
  details: string;
  date: string;
}

interface Props {
  data: CorporateEvent[];
}

export function CorporateEventsTable({ data }: Props) {
  if (!data || data.length === 0) {
    return <p className="text-gray-500">No corporate events available</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
        <thead className="bg-gray-50 dark:bg-slate-800">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Symbol
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Company
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Purpose
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Details
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Date
            </th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200 dark:divide-slate-800">
          {data.map((event, idx) => (
            <tr key={`${event.symbol}-${event.date}-${idx}`} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
              <td className="px-4 py-3 whitespace-nowrap">
                <Link
                  href={`/company/${event.symbol}`}
                  className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                >
                  {event.symbol}
                </Link>
              </td>
              <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 max-w-xs truncate">
                {event.companyName}
              </td>
              <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                {event.purpose}
              </td>
              <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 max-w-xs truncate">
                {event.details}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                {event.date}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
