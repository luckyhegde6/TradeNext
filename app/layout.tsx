// app/layout.tsx
import "./globals.css";
import Header from "./Header";
import { Providers } from "./Providers";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";

export const metadata = {
  title: "TradeNext",
  description: "A blog app using Next.js and Prisma",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ErrorBoundary>
          <Providers>
            <div className="min-h-screen flex flex-col">
              <Header />
              <main className="flex-1">{children}</main>
            </div>
          </Providers>
        </ErrorBoundary>
      </body>
    </html>
  );
}
