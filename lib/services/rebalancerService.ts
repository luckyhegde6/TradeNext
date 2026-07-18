import { Holding } from "./portfolioService";
import logger from "@/lib/logger";

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

// ─── Core functions ──────────────────────────────────────────────────────

/**
 * Compute current allocation from portfolio holdings.
 * Groups holdings by sector (fallback: "Other" if sector unknown).
 */
export function computeCurrentAllocation(holdings: Holding[]): CurrentAllocation[] {
  const totalValue = holdings.reduce((sum, h) => sum + h.currentValue, 0);
  if (totalValue <= 0) return [];

  const sectorMap = new Map<string, number>();
  for (const h of holdings) {
    const sector = h.sector || "Other";
    sectorMap.set(sector, (sectorMap.get(sector) || 0) + h.currentValue);
  }

  const allocations: CurrentAllocation[] = [];
  for (const [name, value] of sectorMap) {
    allocations.push({
      name,
      currentPercent: (value / totalValue) * 100,
      currentValue: value,
      type: "sector",
    });
  }

  return allocations.sort((a, b) => b.currentPercent - a.currentPercent);
}

/**
 * Match stocks to a sector (for trade suggestions).
 */
function getTickersForSector(holdings: Holding[], sector: string): string[] {
  return holdings
    .filter((h) => (h.sector || "Other") === sector)
    .map((h) => h.ticker);
}

/**
 * Compute rebalancer result.
 */
export function computeRebalancer(
  holdings: Holding[],
  profile: RebalancerProfile
): RebalancerResult {
  const totalValue = holdings.reduce((sum, h) => sum + h.currentValue, 0);
  const currentAllocs = computeCurrentAllocation(holdings);

  // Build target map
  const targetMap = new Map<string, number>();
  let allocatedTarget = 0;
  for (const cat of profile.categories) {
    targetMap.set(cat.name, cat.targetPercent);
    allocatedTarget += cat.targetPercent;
  }

  // "Unallocated" bucket
  const unallocatedPercent = Math.max(0, 100 - allocatedTarget);
  const unallocatedValue = (unallocatedPercent / 100) * totalValue;

  // Compute actions
  const actions: RebalancerAction[] = [];
  let isBalanced = true;
  const threshold = profile.driftThreshold;

  // Process target categories
  for (const cat of profile.categories) {
    const current = currentAllocs.find((a) => a.name === cat.name);
    const currentPct = current?.currentPercent ?? 0;
    const drift = Math.abs(currentPct - cat.targetPercent);

    if (drift > threshold) {
      isBalanced = false;
    }

    const diffValue = ((cat.targetPercent - currentPct) / 100) * totalValue;
    const absAmount = Math.abs(diffValue);

    if (absAmount < 100) {
      // Ignore tiny differences
      actions.push({
        category: cat.name,
        type: "HOLD",
        currentPercent: currentPct,
        targetPercent: cat.targetPercent,
        drift,
        amount: 0,
        tickers: current ? getTickersForSector(holdings, cat.name) : [],
      });
    } else {
      actions.push({
        category: cat.name,
        type: diffValue > 0 ? "BUY" : "SELL",
        currentPercent: currentPct,
        targetPercent: cat.targetPercent,
        drift,
        amount: absAmount,
        tickers: current ? getTickersForSector(holdings, cat.name) : [],
      });
    }
  }

  return {
    profile,
    currentAllocations: currentAllocs,
    targetAllocations: profile.categories,
    unallocated: { percent: unallocatedPercent, value: unallocatedValue },
    actions,
    isBalanced,
    totalValue,
  };
}

/**
 * Validate target percentages sum to <= 100%.
 */
export function validateTargets(categories: AllocationCategory[]): {
  valid: boolean;
  total: number;
  error?: string;
} {
  const total = categories.reduce((sum, c) => sum + c.targetPercent, 0);
  if (total > 100) {
    return { valid: false, total, error: `Targets sum to ${total}% (max 100%)` };
  }
  if (total < 100) {
    return { valid: true, total, error: `Unallocated: ${(100 - total).toFixed(1)}%` };
  }
  return { valid: true, total };
}

// ─── Prisma integration ───────────────────────────────────────────────────

import prisma from "@/lib/prisma";

/**
 * Get all rebalancer profiles for a user.
 */
export async function getUserProfiles(userId: number): Promise<RebalancerProfile[]> {
  const configs = await prisma.rebalancerConfig.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  return configs.map(mapConfig);
}

/**
 * Get a single profile by id.
 */
export async function getProfileById(id: string): Promise<RebalancerProfile | null> {
  const config = await prisma.rebalancerConfig.findUnique({ where: { id } });
  return config ? mapConfig(config) : null;
}

/**
 * Create a new rebalancer profile.
 */
export async function createProfile(
  userId: number,
  data: { name?: string; categories: AllocationCategory[]; driftThreshold?: number }
): Promise<RebalancerProfile> {
  const config = await prisma.rebalancerConfig.create({
    data: {
      userId,
      name: data.name || "Default",
      categories: data.categories as any,
      driftThreshold: data.driftThreshold ?? 5,
    },
  });
  return mapConfig(config);
}

/**
 * Update a rebalancer profile.
 */
export async function updateProfile(
  id: string,
  userId: number,
  data: Partial<{ name: string; categories: AllocationCategory[]; driftThreshold: number }>
): Promise<RebalancerProfile | null> {
  const config = await prisma.rebalancerConfig.findFirst({ where: { id, userId } });
  if (!config) return null;

  const updated = await prisma.rebalancerConfig.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.categories !== undefined && { categories: data.categories as any }),
      ...(data.driftThreshold !== undefined && { driftThreshold: data.driftThreshold }),
    },
  });
  return mapConfig(updated);
}

/**
 * Delete a rebalancer profile.
 */
export async function deleteProfile(id: string, userId: number): Promise<boolean> {
  try {
    const config = await prisma.rebalancerConfig.findFirst({ where: { id, userId } });
    if (!config) return false;
    await prisma.rebalancerConfig.delete({ where: { id } });
    return true;
  } catch (err) {
    logger.error({ msg: "Failed to delete rebalancer profile", id, userId, error: err });
    return false;
  }
}

// ─── Mapping helper ──────────────────────────────────────────────────────

function mapConfig(config: any): RebalancerProfile {
  return {
    id: config.id,
    userId: config.userId,
    name: config.name,
    categories: config.categories as AllocationCategory[],
    driftThreshold: Number(config.driftThreshold),
    createdAt: config.createdAt?.toISOString(),
    updatedAt: config.updatedAt?.toISOString(),
  };
}
