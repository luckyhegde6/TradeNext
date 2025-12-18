# TradeNext - Starter Additions (Ingestion + DB + Next.js pages)

## BuildStatus

[![Netlify Status](https://api.netlify.com/api/v1/badges/78401e5d-b137-4b6d-94bb-ad1ec8de6b05/deploy-status)](https://app.netlify.com/projects/tradenext6/deploys)

Live DEMO [link](https://tradenext6.netlify.app/)
This bundle contains starter code to add to your existing `TradeNext` repository:

## Project Details
- Postgres/Timescale DB migrations
- Node TypeScript ingestion script to consume NSE-style CSV and upsert into Timescale
- Next.js starter pages: dashboard, holdings, company    profile (demo charts)
- Piotroski F-score SQL function + TypeScript helper
- docker-compose for local dev (Postgres+Timescale, Redis, API, Frontend)
- AI TODO checklist for implementing remaining features

## **How to use**

1. Unzip and copy the files into your repo root (or review and integrate).  
2. Set environment variables (see `.env.example`).  
3. Start services: `docker-compose up --build`  
4. From `api/` run `npm install` then `npm run dev` to run the ingestion worker locally.
5. Visit Next.js frontend at `http://localhost:3000`.
