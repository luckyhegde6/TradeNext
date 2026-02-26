# TradeNext - Product Requirements Document (PRD)

## 1. Product Overview

**Product Name**: TradeNext  
**Type**: Web Application (SaaS)  
**Target Users**: Indian retail investors, traders, and market enthusiasts  
**Core Value Proposition**: Comprehensive NSE market intelligence with portfolio tracking and analytics

---

## 2. User Personas

### Persona 1: Retail Investor (Ravi)
- **Age**: 28-45
- **Goal**: Track investment portfolio performance
- **Pain Points**: Multiple platforms for market data, hard to track P&L
- **Needs**: Unified dashboard with real-time quotes + portfolio

### Persona 2: Market Enthusiast (Priya)
- **Age**: 22-35
- **Goal**: Stay updated on NSE markets
- **Pain Points**: Fragmented news sources
- **Needs**: Corporate announcements, analytics in one place

### Persona 3: Admin/Portfolio Manager
- **Goal**: Manage platform and user data
- **Needs**: User management, data ingestion tools, system monitoring

---

## 3. Core Features (Current)

### 3.1 Authentication
- [x] Email/password login
- [x] Role-based access (admin/user)
- [x] Session management via NextAuth.js
- [x] Protected routes

### 3.2 Market Data
- [x] NSE Indices (NIFTY 50, BANK, IT, etc.)
- [x] Real-time stock quotes
- [x] Corporate announcements
- [x] Corporate actions (dividends, splits, rights)
- [x] Advances/Declines data

### 3.3 Portfolio Management
- [x] Multi-portfolio support
- [x] Buy/Sell transaction tracking
- [x] Fund deposits/withdrawals
- [x] P&L calculation (realized/unrealized)
- [x] Holdings view with allocation
- [x] Price charts (1D, 1W, 1M, 3M, 6M, 1Y)

### 3.4 Analytics
- [x] Market-wide statistics
- [x] Top gainers/losers
- [x] Most active stocks

### 3.5 Admin Panel
- [x] User management (CRUD)
- [x] System health dashboard
- [x] Data ingestion (CSV/ZIP)
- [x] Role-based access control

---

## 4. Planned Features (Enhancements)

### 4.1 Advanced Analytics (Phase 2)

| Feature | Description | Priority |
|---------|-------------|----------|
| **Technical Indicators** | RSI, MACD, Bollinger Bands on charts | High |
| **Sector Analysis** | Performance by sector (Auto, IT, Pharma) | Medium |
| **Market Breadth** | More detailed advance/decline charts | Medium |
| **Heatmaps** | Sector-wise performance visualization | Medium |
| **Stock Screener** | Filter stocks by P/E, Market Cap, etc. | High |
| **Historical Data** | Download historical quotes | Medium |

### 4.2 Portfolio Enhancements (Phase 2)

| Feature | Description | Priority |
|---------|-------------|----------|
| **Transaction Import** | Import from Excel/CSV | High |
| **Target Price Alerts** | Notify when stock hits target | High |
| **Dividend Tracker** | Track dividend income | Medium |
| **Tax Reports** | Capital gains calculation | Medium |
| **Benchmark Comparison** | Compare vs NIFTY 50 | Medium |
| **Multiple Currencies** | Support USD, INR portfolios | Low |
| **Share Portfolio** | Public portfolio links | Low |

### 4.3 AI/Research Features (Phase 3)

| Feature | Description | Priority |
|---------|-------------|----------|
| **Piotroski F-Score** | Financial strength indicator | High |
| **AI Recommendations** | Buy/Sell signals | High |
| **Sentiment Analysis** | News sentiment for stocks | Medium |
| **Earnings Calendar** | Upcoming results | Medium |
| **Company Comparison** | Compare 2-3 companies | Low |

### 4.4 Social & Community (Phase 3)

| Feature | Description | Priority |
|---------|-------------|----------|
| **Watchlists** | Save stocks to watch | Medium |
| **Price Alerts** | SMS/Email notifications | Medium |
| **User Discussions** | Forum improvements | Low |
| **Follow Users** | Copy trading signals | Low |

---

## 5. Non-Functional Requirements

### Performance
- Page load < 2 seconds
- API response < 500ms
- Real-time quote updates every 15 seconds

### Security
- Password hashing with bcrypt (12 rounds)
- Session-based authentication
- Role-based route protection
- Admin API endpoints secured

### Scalability
- Support 1000+ concurrent users
- Database with TimescaleDB for time-series
- Redis caching for market data

---

## 6. Technical Stack

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 16, React, Tailwind CSS 4.x |
| Backend | Next.js API Routes |
| Database | PostgreSQL + TimescaleDB |
| ORM | Prisma 7 |
| Auth | NextAuth.js |
| Caching | In-memory + Redis |
| Testing | Jest, Playwright |

---

## 7. Roadmap

### Phase 1 (Current)
- ✅ Basic auth & roles
- ✅ Market data display
- ✅ Portfolio CRUD
- ✅ Admin panel

### Phase 2 (Next 3 months)
- [ ] Technical indicators on charts
- [ ] Stock screener
- [ ] Transaction import
- [ ] Price alerts
- [ ] Piotroski F-Score

### Phase 3 (Future)
- [ ] AI recommendations
- [ ] Social features
- [ ] Mobile app
- [ ] Paper trading

---

## 8. Success Metrics

| Metric | Target |
|--------|--------|
| Monthly Active Users | 1000+ |
| Page Load Time | < 2s |
| Portfolio Value Accuracy | 99.9% |
| Market Data Freshness | < 1 min |
| User Retention (30-day) | 40%+ |

---

## 9. Competitors

- **MoneyControl**: More features but cluttered UI
- **Trendlyne**: Good analytics, limited portfolio
- **Investopedia**: Education focus, not portfolio

**Differentiation**: Clean UI + Portfolio + Analytics in one platform
