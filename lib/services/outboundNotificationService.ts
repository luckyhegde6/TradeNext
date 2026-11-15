import { randomUUID } from "crypto";
import logger from "@/lib/logger";
import prisma from "@/lib/prisma";
import { getSqliteFallback } from "@/lib/sqlite";
import { isDbUnavailableError } from "@/lib/db-utils";

export type OutboundChannel = "telegram" | "email" | "webhook" | "in_app" | "system";
export type OutboundStatus = "pending" | "sent" | "failed" | "cancelled" | "retrying" | "skipped";
export type OutboundRecipientType = "user" | "chat" | "channel" | "broadcast_subscriber" | "system" | string;

export interface OutboundNotificationInput {
  id?: string;
  channel: OutboundChannel | string;
  chatId?: string | number | null;
  recipientType?: OutboundRecipientType | null;
  recipientId?: string | number | null;
  notificationType: string;
  title?: string | null;
  message: string;
  messagePreview?: string | null;
  status?: OutboundStatus | string;
  error?: string | null;
  attemptCount?: number;
  lastAttemptAt?: Date | string | null;
  sentAt?: Date | string | null;
  deliveredAt?: Date | string | null;
  source?: string | null;
  triggeredBy?: string | null;
  batchId?: string | null;
  parentId?: string | null;
  metadata?: Record<string, unknown> | null;
  cancelledAt?: Date | string | null;
  cancelledBy?: string | null;
}

export interface OutboundNotificationRecord {
  id: string;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  sentAt?: string | Date | null;
  deliveredAt?: string | Date | null;
  channel: string;
  chatId?: string | null;
  recipientType?: string | null;
  recipientId?: string | null;
  notificationType: string;
  title?: string | null;
  message: string;
  messagePreview?: string | null;
  status: string;
  error?: string | null;
  attemptCount: number;
  lastAttemptAt?: string | Date | null;
  source?: string | null;
  triggeredBy?: string | null;
  batchId?: string | null;
  parentId?: string | null;
  metadata?: Record<string, unknown> | null;
  cancelledAt?: string | Date | null;
  cancelledBy?: string | null;
}

function toIso(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

function toStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function previewOf(text: string | null | undefined, max = 160): string | null {
  if (!text) return null;
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return null;
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function normalizeInput(input: OutboundNotificationInput): OutboundNotificationRecord {
  const now = new Date().toISOString();
  const message = String(input.message ?? "");
  const status = String(input.status ?? "pending");
  const sentAt = toIso(input.sentAt) ?? (status === "sent" ? now : null);
  const deliveredAt = toIso(input.deliveredAt) ?? (status === "sent" && String(input.channel) !== "telegram" ? sentAt : null);
  return {
    id: input.id && String(input.id).trim() ? String(input.id) : randomUUID(),
    createdAt: toIso((input as any).createdAt) ?? now,
    updatedAt: now,
    sentAt,
    deliveredAt,
    channel: String(input.channel),
    chatId: toStr(input.chatId),
    recipientType: toStr(input.recipientType),
    recipientId: toStr(input.recipientId),
    notificationType: String(input.notificationType),
    title: toStr(input.title),
    message,
    messagePreview: toStr(input.messagePreview) ?? previewOf(input.title ? `${input.title} — ${message}` : message),
    status,
    error: toStr(input.error),
    attemptCount: Number.isFinite(Number(input.attemptCount)) ? Number(input.attemptCount) : 0,
    lastAttemptAt: toIso(input.lastAttemptAt) ?? (Number(input.attemptCount ?? 0) > 0 ? now : null),
    source: toStr(input.source),
    triggeredBy: toStr(input.triggeredBy),
    batchId: toStr(input.batchId),
    parentId: toStr(input.parentId),
    metadata: input.metadata ?? null,
    cancelledAt: toIso(input.cancelledAt),
    cancelledBy: toStr(input.cancelledBy),
  };
}

export function createOutboundBatchId(prefix = "obn"): string {
  return `${prefix}_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

function logOutbound(record: OutboundNotificationRecord, event: "recorded" | "updated") {
  const level = record.status === "failed" ? "warn" : "info";
  const payload = {
    msg: event === "recorded" ? "Outbound notification recorded" : "Outbound notification updated",
    event,
    id: record.id,
    batchId: record.batchId,
    channel: record.channel,
    notificationType: record.notificationType,
    status: record.status,
    chatId: record.chatId,
    recipientId: record.recipientId,
    recipientType: record.recipientType,
    source: record.source,
    triggeredBy: record.triggeredBy,
    attemptCount: record.attemptCount,
    sentAt: record.sentAt,
    deliveredAt: record.deliveredAt,
    error: record.error,
    preview: record.messagePreview,
  };
  if (level === "warn") logger.warn(payload);
  else logger.info(payload);
}

async function persistRecord(record: OutboundNotificationRecord): Promise<void> {
  // SQLite-first mirror + outbox when available (zero Prisma ops for outbox-backed writes).
  try {
    const sqlite = getSqliteFallback();
    if (sqlite) {
      sqlite.upsertOutboundNotification(record as unknown as Record<string, unknown>);
      return;
    }
  } catch (err) {
    logger.warn({
      msg: "Outbound notification SQLite persist failed (continuing to Prisma fallback)",
      id: record.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Fallback: direct Prisma write (best-effort). Skip noisy expected DB-unavailable states.
  try {
    await prisma.outboundNotification.upsert({
      where: { id: record.id },
      create: {
        id: record.id,
        createdAt: record.createdAt ? new Date(String(record.createdAt)) : undefined,
        updatedAt: record.updatedAt ? new Date(String(record.updatedAt)) : undefined,
        sentAt: record.sentAt ? new Date(String(record.sentAt)) : null,
        deliveredAt: record.deliveredAt ? new Date(String(record.deliveredAt)) : null,
        channel: record.channel,
        chatId: record.chatId ?? null,
        recipientType: record.recipientType ?? null,
        recipientId: record.recipientId ?? null,
        notificationType: record.notificationType,
        title: record.title ?? null,
        message: record.message,
        messagePreview: record.messagePreview ?? null,
        status: record.status,
        error: record.error ?? null,
        attemptCount: record.attemptCount ?? 0,
        lastAttemptAt: record.lastAttemptAt ? new Date(String(record.lastAttemptAt)) : null,
        source: record.source ?? null,
        triggeredBy: record.triggeredBy ?? null,
        batchId: record.batchId ?? null,
        parentId: record.parentId ?? null,
        metadata: (record.metadata ?? undefined) as any,
        cancelledAt: record.cancelledAt ? new Date(String(record.cancelledAt)) : null,
        cancelledBy: record.cancelledBy ?? null,
      },
      update: {
        updatedAt: record.updatedAt ? new Date(String(record.updatedAt)) : undefined,
        sentAt: record.sentAt ? new Date(String(record.sentAt)) : null,
        deliveredAt: record.deliveredAt ? new Date(String(record.deliveredAt)) : null,
        channel: record.channel,
        chatId: record.chatId ?? null,
        recipientType: record.recipientType ?? null,
        recipientId: record.recipientId ?? null,
        notificationType: record.notificationType,
        title: record.title ?? null,
        message: record.message,
        messagePreview: record.messagePreview ?? null,
        status: record.status,
        error: record.error ?? null,
        attemptCount: record.attemptCount ?? 0,
        lastAttemptAt: record.lastAttemptAt ? new Date(String(record.lastAttemptAt)) : null,
        source: record.source ?? null,
        triggeredBy: record.triggeredBy ?? null,
        batchId: record.batchId ?? null,
        parentId: record.parentId ?? null,
        metadata: (record.metadata ?? undefined) as any,
        cancelledAt: record.cancelledAt ? new Date(String(record.cancelledAt)) : null,
        cancelledBy: record.cancelledBy ?? null,
      },
    });
  } catch (err) {
    if (!isDbUnavailableError(err)) {
      logger.warn({
        msg: "Outbound notification Prisma persist failed",
        id: record.id,
        channel: record.channel,
        notificationType: record.notificationType,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export async function recordOutboundNotification(
  input: OutboundNotificationInput,
): Promise<OutboundNotificationRecord> {
  const record = normalizeInput(input);
  logOutbound(record, "recorded");
  await persistRecord(record);
  return record;
}

export async function updateOutboundNotificationStatus(
  id: string,
  patch: Partial<OutboundNotificationInput> & { status?: OutboundStatus | string },
): Promise<void> {
  const now = new Date().toISOString();
  const sqlite = getSqliteFallback();
  if (sqlite) {
    try {
      const existing = sqlite.getOutboundNotificationById(id);
      if (existing) {
        const merged: Record<string, unknown> = {
          ...existing,
          ...patch,
          id,
          updatedAt: now,
        };
        if (patch.status === "sent" && !merged.sentAt) merged.sentAt = now;
        if (patch.status === "failed" && !merged.lastAttemptAt) merged.lastAttemptAt = now;
        if (patch.status === "cancelled" && !merged.cancelledAt) merged.cancelledAt = now;
        sqlite.upsertOutboundNotification(merged);
        logOutbound(normalizeInput({ ...(merged as any), message: String(merged.message ?? "") }), "updated");
        return;
      }
    } catch (err) {
      logger.warn({ msg: "Outbound notification SQLite status update failed", id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  try {
    const data: any = { updatedAt: new Date(now) };
    if (patch.status != null) data.status = String(patch.status);
    if (patch.error !== undefined) data.error = patch.error == null ? null : String(patch.error);
    if (patch.sentAt !== undefined) data.sentAt = patch.sentAt ? new Date(String(patch.sentAt)) : null;
    if (patch.deliveredAt !== undefined) data.deliveredAt = patch.deliveredAt ? new Date(String(patch.deliveredAt)) : null;
    if (patch.lastAttemptAt !== undefined) data.lastAttemptAt = patch.lastAttemptAt ? new Date(String(patch.lastAttemptAt)) : null;
    if (patch.attemptCount !== undefined) data.attemptCount = Number(patch.attemptCount);
    if (patch.cancelledAt !== undefined) data.cancelledAt = patch.cancelledAt ? new Date(String(patch.cancelledAt)) : null;
    if (patch.cancelledBy !== undefined) data.cancelledBy = patch.cancelledBy == null ? null : String(patch.cancelledBy);
    if (patch.metadata !== undefined) data.metadata = patch.metadata as any;
    if (patch.status === "sent") data.sentAt = data.sentAt ?? new Date(now);
    if (patch.status === "cancelled") data.cancelledAt = data.cancelledAt ?? new Date(now);
    await prisma.outboundNotification.update({ where: { id }, data });
  } catch (err) {
    if (!isDbUnavailableError(err)) {
      logger.warn({ msg: "Outbound notification Prisma status update failed", id, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

export async function recordOutboundNotifications(
  inputs: OutboundNotificationInput[],
): Promise<OutboundNotificationRecord[]> {
  const out: OutboundNotificationRecord[] = [];
  for (const input of inputs) {
    try {
      out.push(await recordOutboundNotification(input));
    } catch {
      // recordOutboundNotification is best-effort; keep going for other recipients
    }
  }
  return out;
}

export interface OutboundNotificationQuery {
  channel?: string;
  status?: string;
  notificationType?: string;
  source?: string;
  chatId?: string;
  search?: string;
  q?: string;
  from?: string;
  to?: string;
  batchId?: string;
  recipientId?: string;
  limit?: number;
  offset?: number;
}

export async function getOutboundNotificationById(
  id: string,
): Promise<Record<string, unknown> | null> {
  if (!id) return null;
  try {
    const sqlite = getSqliteFallback();
    if (sqlite) {
      const row = sqlite.getOutboundNotificationById(id);
      if (row) return row;
    }
  } catch {
    // fall through
  }
  try {
    const row = await prisma.outboundNotification.findUnique({ where: { id } });
    return row ? (row as unknown as Record<string, unknown>) : null;
  } catch (err) {
    if (!isDbUnavailableError(err)) {
      logger.warn({ msg: "Outbound notification lookup failed", id, error: err instanceof Error ? err.message : String(err) });
    }
    return null;
  }
}

export async function getOutboundNotifications(
  filters: OutboundNotificationQuery = {},
): Promise<Record<string, unknown>[]> {
  const limit = Math.min(500, Math.max(1, Number(filters.limit ?? 100)));
  const offset = Math.max(0, Number(filters.offset ?? 0));
  try {
    const sqlite = getSqliteFallback();
    if (sqlite) {
      return sqlite.getOutboundNotifications({
        channel: filters.channel,
        status: filters.status,
        notificationType: filters.notificationType,
        chatId: filters.chatId,
        batchId: filters.batchId,
        recipientId: filters.recipientId,
        source: filters.source,
        q: filters.q ?? filters.search,
        limit,
        offset,
      } as any) as unknown as Record<string, unknown>[];
    }
  } catch {
    // fall through
  }

  try {
    const where: any = {};
    if (filters.channel) where.channel = filters.channel;
    if (filters.status) where.status = filters.status;
    if (filters.notificationType) where.notificationType = filters.notificationType;
    if (filters.source) where.source = filters.source;
    if (filters.chatId) where.chatId = { contains: filters.chatId };
    if (filters.batchId) where.batchId = filters.batchId;
    if (filters.recipientId) where.recipientId = filters.recipientId;
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = new Date(filters.from);
      if (filters.to) where.createdAt.lte = new Date(filters.to);
    }
    const search = filters.search ?? filters.q;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { message: { contains: search, mode: "insensitive" } },
        { chatId: { contains: search, mode: "insensitive" } },
        { notificationType: { contains: search, mode: "insensitive" } },
        { source: { contains: search, mode: "insensitive" } },
        { error: { contains: search, mode: "insensitive" } },
      ];
    }
    const rows = await prisma.outboundNotification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });
    return rows as unknown as Record<string, unknown>[];
  } catch (err) {
    if (!isDbUnavailableError(err)) {
      logger.warn({ msg: "Outbound notifications query failed", error: err instanceof Error ? err.message : String(err) });
    }
    return [];
  }
}
