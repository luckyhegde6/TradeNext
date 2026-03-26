// app/layout.tsx
import "./globals.css";
import Header from "./Header";
import Breadcrumbs from "./components/ui/Breadcrumbs";
import { Providers } from "./Providers";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { Analytics } from "./components/analytics";
import { SEOTags, defaultMetadata } from "./components/seo";
import WebVitals from "./components/analytics/WebVitals";

// Apply default SEO metadata
export const metadata = defaultMetadata;

/**
 * Root Layout
 * 
 * SEO & Analytics:
 * - Google Analytics 4 via @next/third-parties
 * - JSON-LD structured data (Organization, WebSite, WebPage)
 * - OpenGraph and Twitter Card meta tags
 * - Canonical URLs and language settings
 * - Core Web Vitals tracking
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-gray-50 dark:bg-slate-950 text-gray-900 dark:text-slate-100 flex flex-col">
        <ErrorBoundary>
          <Providers>
            <Header />

            {/* Content container */}
            <main className="flex-1 overflow-y-auto">
              <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
                <Breadcrumbs />
                {children}
              </div>
            </main>

            {/* SEO Structured Data (rendered server-side) */}
            <SEOTags />

            {/* Google Analytics (rendered client-side) */}
            <Analytics />

            {/* Core Web Vitals tracking */}
            <WebVitals />
          </Providers>
        </ErrorBoundary>
      </body>
    </html>
  );
}
