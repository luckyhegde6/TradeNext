# TradeNext Implementation TODO

> **Reference:** See `.agents/TODO.md` for detailed implementation checklist

## Quick Reference

| Category | Status |
|----------|--------|
| Database Migrations | [x] Complete |
| Authentication | [x] Complete |
| API Endpoints | [x] Complete |
| Admin Routes | [x] Complete |
| Portfolio Engine | [x] Complete |
| Market Data | [x] Complete |
| NSE Integration | [x] Complete |
| Testing | [x] Complete |
| Enhanced Charts | [x] Complete |
| Technical Indicators | [x] Complete |
| Stock Screener | [x] Complete |
| Price Alerts | [x] Complete |
| CSV Import | [x] Complete |
| User Recommendations | [ ] In Progress |
| Watchlist | [ ] In Progress |
| Enhanced Alerts | [ ] Pending |
| Portfolio Analytics | [ ] Pending |
| Stock Compare | [ ] Pending |

## Current Features

### Completed
- NextAuth.js with role-based access (admin/user)
- Prisma 7 with PostgreSQL/TimescaleDB
- Portfolio management with transactions
- NSE market data integration
- Corporate announcements & actions
- Admin dashboard and user management
- Technical indicators (RSI, MACD, Bollinger Bands, SMA, EMA)
- Stock Screener with filters
- Price Alerts system
- CSV/Excel import for transactions
- Piotroski F-Score
- Stock Recommendations Management (admin)
- User Holdings Management
- Audit Logging
- Rate Limiting
- User Recommendations Page (/recommendations)
- Watchlist Feature
- NSE Charting Integration
- **Enhanced Corporate Actions (v1.4.0)**:
  - Dividend per share and yield display
  - Clickable type filter tiles
  - Search by symbol/company
  - Pagination with smart navigation
  - Enhanced upcoming table with expand/collapse
  - Better date formatting with day of week
  - Type badges with icons (💰✂️🎁📈🔄)
  - Urgency-based row highlighting
  - DataTable sorting for all analytics tables
  - Fixed Advance/Decline counts display
- **Development Checks** (`scripts/dev-checks/`):
  - `check-db.js` - Database connection and users
  - `check-schema.js` - Schema verification
  - `check-deals.js` - Deals data check
  - `test-auth.js` - Authentication testing

---

## Phase 1: User Recommendations & Watchlist

### User Recommendations Page (/recommendations) - ✅ COMPLETE
- [x] Display only active recommendations
- [x] Filter by type (BUY/SELL/HOLD)
- [x] Subscribe to specific recommendations
- [x] API endpoint exists at `/api/user/recommendations`

### Watchlist Feature - ✅ COMPLETE
- [x] CRUD for watchlists (via `/api/user/watchlist`)
- [x] Add stocks to watchlist from any page
- [x] Quick price view on watchlist page

### NSE Charting Integration - ✅ COMPLETE
- [x] Chart button in StockQuoteHeader component
- [x] Chart column in HoldingsTable
- [x] Enhanced index chart links in markets page
- [x] Smooth NSE symbol mapping (stock symbols + `-EQ` suffix)
- [x] Direct integration with NSE charting platform
- [x] Mobile-responsive chart buttons

---

## Phase 2: Enhanced Alerts

### Notification System - ⏳ PENDING
- [ ] In-app notifications
- [ ] Email notifications
- [ ] SMS alerts (optional)

### Smart Alerts - ⏳ PENDING
- [ ] Price target alerts
- [ ] Percentage change alerts
- [ ] Volume spike alerts

---

## Phase 3: Portfolio Enhancements

### Advanced Analytics - ⏳ PENDING
- [ ] P&L visualization
- [ ] Sector-wise allocation pie chart
- [ ] Risk metrics (beta, volatility)

### Comparison Tool - ⏳ PENDING
- [ ] Compare stocks
- [ ] Compare portfolio vs benchmark (NIFTY 50)

---

## Engineering Standards

All implementations must follow:
- `.agents/rules/checklist.md` - Engineering guardrails
- `AGENTS.md` - Development guide
- **NSE Charting Integration** - Uses NSE's official charting platform for seamless user experience

## Commands

```bash
# Setup
npm install
npm run db:up
npx prisma migrate dev
npx prisma db seed

# Development
npm run dev

# Testing
npm run test
npm run lint
```
