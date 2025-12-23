// app/layout.tsx
import "./globals.css";
import Header from "./Header";
import { Providers } from "./Providers";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";

export const metadata = {
  title: {
    default: "TradeNext - Smart NSE Analytics & Portfolio Manager",
    template: "%s | TradeNext",
  },
  description: "Advanced market insights, real-time NSE analytics, and smart portfolio tracking with TradeNext (also known as TradeNext6 or TradeNxt).",
  keywords: ["TradeNext", "TradeNext6", "TradeNxt", "NSE Analytics", "Stock Portfolio Manager", "Market Insights", "India Stocks"],
  authors: [{ name: "TradeNext Team" }],
  openGraph: {
    title: "TradeNext - Smart NSE Analytics",
    description: "Track your stocks and analyze the market with TradeNext.",
    url: "https://tradenext.com",
    siteName: "TradeNext",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TradeNext - Smart NSE Analytics",
    description: "Advanced market insights and portfolio tracking.",
  },
  icons: {
    icon: "/favicon.ico",
  },
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
