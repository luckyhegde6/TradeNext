# Version History v1.11

> From TradeNext version history. Index: [../CHANGELOG.md](../CHANGELOG.md). All v1.x files: [versions-v1.md](./versions-v1.md).

- **v1.11.1** - Worker Task Management Fix (March 21, 2026). Fixed worker task actions in admin panel:
  - **Run Now Button**: Added to UI for pending/failed tasks - executes task immediately via PATCH API
  - **Retry Button**: Added for failed tasks - resets and re-executes the task
  - **Cancel Button**: Fixed to use PATCH API instead of PUT, properly updates status
  - **Delete Button**: Fixed to use PATCH API with action: "delete"
  - **API Endpoints**: All task actions now use consistent PATCH endpoint with action types
- **v1.11.0** - Google Analytics & SEO Enhancement (March 21, 2026). Added comprehensive SEO and analytics integration:
  - **Google Analytics 4**: Installed `@next/third-parties`, created `app/components/analytics/GoogleAnalytics.tsx` with GA4 integration. Only loads if `NEXT_PUBLIC_GA_ID` is set and validates GA ID format.
  - **Custom Event Tracking**: Created `app/components/analytics/trackEvent.ts` with sanitized `trackEvent()`, `trackPageView()`, `trackTiming()`, and helper functions (`StockTracking`, `AdminTracking`).
  - **SEO Metadata**: Created `app/components/seo/` with Organization, WebSite, WebPage, and Stock JSON-LD schemas. Added `SEOTags` component with comprehensive metadata.
  - **Dynamic Sitemap**: Enhanced `app/sitemap.ts` with all public pages, priority levels, and change frequencies.
  - **Robots.txt**: Enhanced `app/robots.ts` with Googlebot and Bingbot specific rules.
  - **Page Metadata**: Added `metadata.ts` files to `/markets`, `/markets/screener`, `/markets/analytics`, `/portfolio`, `/news`, `/alerts` routes.
  - **Root Layout Update**: Updated `app/layout.tsx` to include `<SEOTags />` and `<Analytics />` components.
  - **Environment Variables**: Updated `.env.example` with `NEXT_PUBLIC_BASE_URL` and `NEXT_PUBLIC_GA_ID`.
  - **Security**: All event tracking sanitizes inputs to prevent XSS. GA only loads with valid ID format.
