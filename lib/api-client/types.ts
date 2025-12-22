// Auto-generated types from OpenAPI spec
// Generated on: 2025-01-01

export interface User {
  id: number;
  name: string | null;
  email: string;
  createdAt: string;
}

export interface StockQuote {
  symbol: string;
  companyName: string;
  identifier: string;
  isinCode: string;
  series: string;
  lastPrice: number;
  open: number;
  dayHigh: number;
  dayLow: number;
  previousClose: number;
  change: number;
  pChange: number;
  totalTradedVolume: number;
  totalTradedValue: number;
  yearHigh: number;
  yearLow: number;
  peRatio: number;
  marketCap: number;
  industry: string;
  sector: string;
  indexList: string[];
}

export interface IndexQuote {
  indexName: string;
  lastPrice: string;
  change: string;
  pChange: string;
  open: string;
  high: string;
  low: string;
  previousClose: string;
  yearHigh: string;
  yearLow: string;
  peRatio: string;
  pbRatio: string;
  dividendYield: string;
  marketStatus: string;
  advances: number;
  declines: number;
  unchanged: number;
  totalTradedVolume: string;
  totalTradedValue: string;
  timestamp: string;
}

export interface PaginatedResponse<T = any> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface Error {
  error: string;
  details?: string[];
}
