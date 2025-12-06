"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function MarketsNav() {
    const pathname = usePathname();
    const isActive = pathname?.startsWith("/markets");

    return (
        <Link
            href="/markets"
            className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors ${isActive
                    ? "border-blue-500 text-gray-900"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`}
        >
            Markets
        </Link>
    );
}
