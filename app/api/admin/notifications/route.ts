import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getSqliteFallback } from "@/lib/sqlite";
import { createAuditLog } from "@/lib/audit";
import {
  getOutboundNotificationById,
  getOutboundNotifications,
  updateOutboundNotificationStatus,
} from "@/lib/services/outboundNotificationService";
import { sendAlertToUser } from "@/lib/services/telegramBotService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAdmin(session: any) {
  return session?.user?.role === "admin";
}

function toInt(v: string | null, d: number) {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!isAdmin(session)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (id) {
      const item = await getOutboundNotificationById(id);
      if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ item });
    }

    const filters = {
      channel: searchParams.get("channel") || undefined,
      status: searchParams.get("status") || undefined,
      notificationType: searchParams.get("notificationType") || searchParams.get("type") || undefined,
      source: searchParams.get("source") || undefined,
      chatId: searchParams.get("chatId") || undefined,
      search: searchParams.get("search") || searchParams.get("q") || undefined,
      from: searchParams.get("from") || undefined,
      to: searchParams.get("to") || undefined,
      limit: Math.min(500, Math.max(1, toInt(searchParams.get("limit"), 100))),
      offset: Math.max(0, toInt(searchParams.get("offset"), 0)),
    };

    const sqlite = getSqliteFallback();
    let items: any[] = [];
    let total = 0;

    if (sqlite) {
      items = sqlite.getOutboundNotifications(filters as any) as any[];
      total = sqlite.countOutboundNotifications(filters as any);
    } else {
      const where: any = {};
      if (filters.channel) where.channel = filters.channel;
      if (filters.status) where.status = filters.status;
      if (filters.notificationType) where.notificationType = filters.notificationType;
      if (filters.source) where.source = filters.source;
      if (filters.chatId) where.chatId = { contains: filters.chatId };
      if (filters.from || filters.to) {
        where.createdAt = {};
        if (filters.from) where.createdAt.gte = new Date(filters.from);
        if (filters.to) where.createdAt.lte = new Date(filters.to);
      }
      if (filters.search) {
        where.OR = [
          { title: { contains: filters.search, mode: "insensitive" } },
          { message: { contains: filters.search, mode: "insensitive" } },
          { chatId: { contains: filters.search, mode: "insensitive" } },
          { notificationType: { contains: filters.search, mode: "insensitive" } },
          { source: { contains: filters.search, mode: "insensitive" } },
          { error: { contains: filters.search, mode: "insensitive" } },
        ];
      }
      [items, total] = await Promise.all([
        prisma.outboundNotification.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: filters.limit,
          skip: filters.offset,
        }),
        prisma.outboundNotification.count({ where }),
      ]);
    }

    // Summary counts (best-effort from current page/filter scope-lite)
    const byStatus: Record<string, number> = {};
    for (const it of items) {
      const s = String(it.status || "unknown");
      byStatus[s] = (byStatus[s] || 0) + 1;
    }

    return NextResponse.json({ items, total, limit: filters.limit, offset: filters.offset, byStatus });
  } catch (error) {
    console.error("Admin notifications GET error:", error);
    return NextResponse.json({ error: "Failed to fetch outbound notifications" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!isAdmin(session)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").toLowerCase();
    const ids: string[] = Array.isArray(body?.ids)
      ? body.ids.map((x: any) => String(x)).filter(Boolean)
      : body?.id
        ? [String(body.id)]
        : [];

    if (!action) return NextResponse.json({ error: "action is required" }, { status: 400 });
    if (ids.length === 0) return NextResponse.json({ error: "id or ids is required" }, { status: 400 });

    const adminId = session?.user?.id ? parseInt(session.user.id) : undefined;
    const adminEmail = session?.user?.email;
    const results: Array<{ id: string; ok: boolean; status?: string; error?: string }> = [];

    for (const id of ids) {
      const item = await getOutboundNotificationById(id);
      if (!item) {
        results.push({ id, ok: false, error: "Not found" });
        continue;
      }

      try {
        if (action === "cancel") {
          if (["sent", "delivered"].includes(String(item.status))) {
            results.push({ id, ok: false, error: `Cannot cancel ${item.status}` });
            continue;
          }
          await updateOutboundNotificationStatus(id, { status: "cancelled", cancelledAt: new Date(), metadata: { ...(item.metadata || {}), cancelledBy: adminEmail || adminId || "admin" } });
          await createAuditLog({ userId: adminId, userEmail: adminEmail, action: "ADMIN_OUTBOUND_NOTIFICATION_CANCEL", resource: "outbound_notification", resourceId: id, metadata: { previousStatus: item.status } });
          results.push({ id, ok: true, status: "cancelled" });
          continue;
        }

        if (action === "retry") {
          // Best-effort retry: currently supported for Telegram records with chatId+message.
          if (String(item.channel).toLowerCase() !== "telegram" || !item.chatId) {
            await updateOutboundNotificationStatus(id, {
              status: "retry_requested",
              metadata: { ...(item.metadata || {}), retryRequestedBy: adminEmail || adminId || "admin", retryRequestedAt: new Date().toISOString() },
            });
            await createAuditLog({ userId: adminId, userEmail: adminEmail, action: "ADMIN_OUTBOUND_NOTIFICATION_RETRY_REQUESTED", resource: "outbound_notification", resourceId: id, metadata: { channel: item.channel, status: item.status } });
            results.push({ id, ok: true, status: "retry_requested" });
            continue;
          }

          const text = String(item.message || "");
          const ok = await sendAlertToUser(String(item.chatId), String(item.title || "Notification"), text, undefined, {
            prependTitle: false,
            notificationType: String(item.notificationType || "retry_notification"),
            source: "admin_notifications_retry",
            triggeredBy: `admin:${adminEmail || adminId || "admin"}`,
            recipientType: String(item.recipientType || "chat"),
            recipientId: item.recipientId ? String(item.recipientId) : String(item.chatId),
            metadata: { ...(item.metadata || {}), retriedFromId: id },
          });

          await updateOutboundNotificationStatus(id, {
            status: ok ? "sent" : "failed",
            attemptCount: Number(item.attemptCount || 0) + 1,
            lastAttemptAt: new Date(),
            sentAt: ok ? new Date() : ((item.sentAt as string | Date | null | undefined) ?? null),
            error: ok ? null : "Retry send failed",
            metadata: { ...(item.metadata || {}), lastRetryBy: adminEmail || adminId || "admin", lastRetryOk: ok },
          });
          await createAuditLog({ userId: adminId, userEmail: adminEmail, action: "ADMIN_OUTBOUND_NOTIFICATION_RETRY", resource: "outbound_notification", resourceId: id, metadata: { ok } });
          results.push({ id, ok: true, status: ok ? "sent" : "failed" });
          continue;
        }

        return NextResponse.json({ error: `Unsupported action: ${action}` }, { status: 400 });
      } catch (e: any) {
        results.push({ id, ok: false, error: e?.message || String(e) });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    return NextResponse.json({ success: okCount > 0, action, results, okCount, total: ids.length });
  } catch (error) {
    console.error("Admin notifications PATCH error:", error);
    return NextResponse.json({ error: "Failed to update outbound notifications" }, { status: 500 });
  }
}
