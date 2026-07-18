/**
 * Rebalancer types and constants — safe for client component imports.
 * Separated from rebalancerService.ts to avoid bundling Prisma/node modules on the client.
 */
import type { Holding } from "./portfolioService";

// ─── Types ───────────────────────────────────────────────────────────────

export interface AllocationCategory {
  name: string;
  targetPercent: number;
  type: "sector" | "market_cap" | "custom";
}

export interface RebalancerProfile {
  id: string;
  userId: number;
  name: string;
  categories: AllocationCategory[];
  driftThreshold: number; // percent
  createdAt?: string;
  updatedAt?: string;
}

export interface CurrentAllocation {
  name: string;
  currentPercent: number;
  currentValue: number;
  type: "sector" | "market_cap" | "custom";
}

export interface RebalancerAction {
  category: string;
  type: "BUY" | "SELL" | "HOLD";
  currentPercent: number;
  targetPercent: number;
  drift: number; // absolute percent difference
  amount: number; // rupee amount to buy/sell
  tickers?: string[]; // suggested tickers for this category
}

export interface RebalancerResult {
  profile: RebalancerProfile;
  currentAllocations: CurrentAllocation[];
  targetAllocations: AllocationCategory[];
  unallocated: { percent: number; value: number };
  actions: RebalancerAction[];
  isBalanced: boolean;
  totalValue: number;
}

// ─── Sector defaults ─────────────────────────────────────────────────────

export const DEFAULT_SECTOR_TARGETS: AllocationCategory[] = [
  { name: "Financial Services", targetPercent: 20, type: "sector" },
  { name: "Technology", targetPercent: 15, type: "sector" },
  { name: "Energy", targetPercent: 10, type: "sector" },
  { name: "Automobile", targetPercent: 10, type: "sector" },
  { name: "Pharmaceuticals", targetPercent: 10, type: "sector" },
  { name: "FMCG", targetPercent: 10, type: "sector" },
  { name: "Infrastructure", targetPercent: 10, type: "sector" },
  { name: "Other", targetPercent: 15, type: "sector" },
];
