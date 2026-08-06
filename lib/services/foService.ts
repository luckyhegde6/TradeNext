import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

// ─── Types ───────────────────────────────────────────────────────────────

export type FOPositionType = "FUTURES" | "CALL" | "PUT";
export type FODirection = "LONG" | "SHORT";
export type FOStatus = "OPEN" | "CLOSED";

export interface FOPositionData {
  id: string;
  userId: number;
  symbol: string;
  type: FOPositionType;
  direction: FODirection;
  quantity: number;
  entryPrice: number;
  currentPrice: number | null;
  premium: number | null;
  strike: number | null;
  expiry: string | null;
  status: FOStatus;
  closePrice: number | null;
  closeDate: string | null;
  pnl: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FOPositionInput {
  symbol: string;
  type: FOPositionType;
  direction: FODirection;
  quantity: number;
  entryPrice: number;
  premium?: number;
  strike?: number;
  expiry?: string;
  notes?: string;
}

export interface FOPositionUpdate {
  currentPrice?: number;
  status?: FOStatus;
  closePrice?: number;
  closeDate?: string;
  pnl?: number;
  notes?: string;
}

export interface FOPortfolioSummary {
  totalPositions: number;
  openPositions: number;
  closedPositions: number;
  totalPnl: number;
  longCount: number;
  shortCount: number;
  futuresCount: number;
  optionsCount: number;
}

// ─── CRUD Functions ──────────────────────────────────────────────────────

function mapPosition(p: any): FOPositionData {
  return {
    id: p.id,
    userId: p.userId,
    symbol: p.symbol,
    type: p.type as FOPositionType,
    direction: p.direction as FODirection,
    quantity: p.quantity,
    entryPrice: Number(p.entryPrice),
    currentPrice: p.currentPrice ? Number(p.currentPrice) : null,
    premium: p.premium ? Number(p.premium) : null,
    strike: p.strike ? Number(p.strike) : null,
    expiry: p.expiry ? p.expiry.toISOString() : null,
    status: p.status as FOStatus,
    closePrice: p.closePrice ? Number(p.closePrice) : null,
    closeDate: p.closeDate ? p.closeDate.toISOString() : null,
    pnl: p.pnl ? Number(p.pnl) : null,
    notes: p.notes || null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function getPositions(
  userId: number,
  options?: { status?: FOStatus; symbol?: string }
): Promise<FOPositionData[]> {
  const where: any = { userId };
  if (options?.status) where.status = options.status;
  if (options?.symbol) where.symbol = options.symbol;

  const positions = await prisma.fOPosition.findMany({
    where,
    orderBy: { updatedAt: "desc" },
  });
  return positions.map(mapPosition);
}

export async function getPositionById(id: string, userId: number): Promise<FOPositionData | null> {
  const pos = await prisma.fOPosition.findFirst({ where: { id, userId } });
  return pos ? mapPosition(pos) : null;
}

export async function createPosition(userId: number, input: FOPositionInput): Promise<FOPositionData> {
  const expiry = input.expiry ? new Date(input.expiry) : null;

  const pos = await prisma.fOPosition.create({
    data: {
      userId,
      symbol: input.symbol.toUpperCase(),
      type: input.type,
      direction: input.direction,
      quantity: input.quantity,
      entryPrice: input.entryPrice,
      premium: input.premium ?? null,
      strike: input.strike ?? null,
      expiry,
      notes: input.notes || null,
    },
  });
  return mapPosition(pos);
}

export async function updatePosition(
  id: string,
  userId: number,
  input: FOPositionUpdate
): Promise<FOPositionData | null> {
  const existing = await prisma.fOPosition.findFirst({ where: { id, userId } });
  if (!existing) return null;

  const data: any = {};
  if (input.currentPrice !== undefined) data.currentPrice = input.currentPrice;
  if (input.status !== undefined) data.status = input.status;
  if (input.closePrice !== undefined) data.closePrice = input.closePrice;
  if (input.closeDate !== undefined) data.closeDate = new Date(input.closeDate);
  if (input.pnl !== undefined) data.pnl = input.pnl;
  if (input.notes !== undefined) data.notes = input.notes;

  const updated = await prisma.fOPosition.update({ where: { id }, data });
  return mapPosition(updated);
}

export async function deletePosition(id: string, userId: number): Promise<boolean> {
  try {
    const existing = await prisma.fOPosition.findFirst({ where: { id, userId } });
    if (!existing) return false;
    await prisma.fOPosition.delete({ where: { id } });
    return true;
  } catch (err) {
    logger.error({ msg: "Failed to delete F&O position", id, userId, error: err });
    return false;
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────

export async function getPortfolioSummary(userId: number): Promise<FOPortfolioSummary> {
  const all = await prisma.fOPosition.findMany({ where: { userId } });
  const open = all.filter((p) => p.status === "OPEN");
  const closed = all.filter((p) => p.status === "CLOSED");

  const totalPnl = all.reduce((sum, p) => sum + Number(p.pnl || 0), 0);

  return {
    totalPositions: all.length,
    openPositions: open.length,
    closedPositions: closed.length,
    totalPnl,
    longCount: all.filter((p) => p.direction === "LONG").length,
    shortCount: all.filter((p) => p.direction === "SHORT").length,
    futuresCount: all.filter((p) => p.type === "FUTURES").length,
    optionsCount: all.filter((p) => p.type === "CALL" || p.type === "PUT").length,
  };
}

// ─── Compute P&L ─────────────────────────────────────────────────────────

export function computePositionPnl(pos: Pick<FOPositionData, "type" | "direction" | "quantity" | "entryPrice" | "currentPrice" | "closePrice">): {
  pnl: number;
  currentPriceUsed: number;
} {
  const currentPrice = pos.closePrice ?? pos.currentPrice ?? pos.entryPrice;
  const diff = currentPrice - pos.entryPrice;

  let pnl: number;
  if (pos.type === "FUTURES") {
    // Futures: P&L = (current - entry) * qty * lot multiplier
    pnl = diff * pos.quantity;
  } else {
    // Options: P&L = (current - entry) * qty (premium difference)
    pnl = diff * pos.quantity;
  }

  // Short direction flips sign
  if (pos.direction === "SHORT") pnl = -pnl;

  return { pnl, currentPriceUsed: currentPrice };
}
