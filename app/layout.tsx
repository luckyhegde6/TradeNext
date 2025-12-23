// app/layout.tsx
import "./globals.css";
import Header from "./Header";
import { Providers } from "./Providers";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";

export const metadata = {
  title: "TradeNext",
  description: "Market insights, portfolios, and NSE analytics",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 dark:bg-slate-950 text-gray-900 dark:text-slate-100">
        <ErrorBoundary>
          <Providers>
            <div className="min-h-screen flex flex-col">
              <Header />

              {/* Content container */}
              <main className="flex-1">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                  {children}
                </div>
              </main>
            </div>
          </Providers>
        </ErrorBoundary>
      </body>
    </html>
  );
}
