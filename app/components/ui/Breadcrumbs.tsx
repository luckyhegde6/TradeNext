"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRightIcon, HomeIcon } from "@heroicons/react/20/solid";

export default function Breadcrumbs() {
    const pathname = usePathname();

    // Don't show breadcrumbs on the home page
    if (pathname === "/") return null;

    const pathSegments = pathname.split("/").filter((segment) => segment !== "");

    const breadcrumbs = pathSegments.map((segment, index) => {
        const href = `/${pathSegments.slice(0, index + 1).join("/")}`;
        const label = segment
            .replace(/-/g, " ")
            .replace(/\b\w/g, (l) => l.toUpperCase());

        return {
            label,
            href,
            current: index === pathSegments.length - 1,
        };
    });

    return (
        <nav className="flex mb-6 overflow-x-auto no-scrollbar" aria-label="Breadcrumb">
            <ol role="list" className="flex items-center space-x-2 whitespace-nowrap">
                <li>
                    <div>
                        <Link
                            href="/"
                            className="text-gray-400 hover:text-gray-500 dark:text-slate-500 dark:hover:text-slate-400 p-1"
                        >
                            <HomeIcon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
                            <span className="sr-only">Home</span>
                        </Link>
                    </div>
                </li>
                {breadcrumbs.map((breadcrumb) => (
                    <li key={breadcrumb.href}>
                        <div className="flex items-center">
                            <ChevronRightIcon
                                className="h-5 w-5 flex-shrink-0 text-gray-300 dark:text-slate-700"
                                aria-hidden="true"
                            />
                            <Link
                                href={breadcrumb.href}
                                className={`ml-2 text-sm font-medium ${breadcrumb.current
                                        ? "text-blue-600 dark:text-blue-400 pointer-events-none"
                                        : "text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
                                    }`}
                                aria-current={breadcrumb.current ? "page" : undefined}
                            >
                                {breadcrumb.label}
                            </Link>
                        </div>
                    </li>
                ))}
            </ol>
        </nav>
    );
}
