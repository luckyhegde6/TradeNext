# TradeNext - Starter Additions (Ingestion + DB + Next.js pages)

## BuildStatus

[![Netlify Status](https://api.netlify.com/api/v1/badges/78401e5d-b137-4b6d-94bb-ad1ec8de6b05/deploy-status)](https://app.netlify.com/projects/tradenext6/deploys)

Live DEMO [link](https://tradenext6.netlify.app/)
This bundle contains starter code to add to your existing `TradeNext` repository:

## Project Details
- **User Management**: Secure signup with email verification, role-based access control (Admin/User).
- **Profile Management**: Integrated modal for updating user details (Name, Mobile) and password management.
- **Portfolio Engine**: 
    - Real-time P&L tracking and cost-basis analysis.
    - Transaction history for both stocks (Buy/Sell) and cash (Deposit/Withdraw).
    - Advanced internal charts replacing external widgets for premium performance.
    - AI-ready recommendations and FY performance reports (PDF/CSV).
- **Market Intelligence**: Comprehensive NSE data tracking (quotes, charts, corporate actions).
- Piotroski F-score SQL function + TypeScript helper.
- Docker-ready infrastructure for local development.

## **How to use**

1. Unzip and copy the files into your repo root (or review and integrate).  
2. Set environment variables (see `.env.example`).  
3. Start services: `docker-compose up --build`  
4. From `api/` run `npm install` then `npm run dev` to run the ingestion worker locally.
5. Visit Next.js frontend at `http://localhost:3000`.
