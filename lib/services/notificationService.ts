import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { sendAlertToUser } from "@/lib/services/telegramBotService";
import { recordOutboundNotification } from "@/lib/services/outboundNotificationService";

// Shared helpers for auth-flow notifications (join requests, password resets).
// All notifications are best-effort: failures are logged, never thrown.

type Recipient = { id: number; telegramChatId: string | null; telegramVerified: boolean };

function isTelegramDeliveryPossible(user: Recipient | null): user is Recipient {
  return Boolean(user && user.telegramChatId && user.telegramVerified);
}

async function createInAppNotification(
  userId: number,
  title: string,
  message: string,
  link?: string
): Promise<void> {
  try {
    const n = await prisma.notification.create({
      data: {
        userId,
        title,
        message,
        link,
        type: "system",
        isRead: false,
      },
    });
    await recordOutboundNotification({
      channel: "in_app",
      chatId: null,
      recipientType: "user",
      recipientId: String(userId),
      notificationType: "system_notification",
      title,
      message,
      status: "sent",
      attemptCount: 1,
      sentAt: new Date(),
      deliveredAt: new Date(),
      source: "notification_service",
      triggeredBy: "system",
      metadata: { notificationId: n.id, link: link ?? null, type: "system" },
    }).catch(() => {});
  } catch (err) {
    logger.error({ msg: "Failed to create in-app notification", userId, error: err });
    await recordOutboundNotification({
      channel: "in_app",
      chatId: null,
      recipientType: "user",
      recipientId: String(userId),
      notificationType: "system_notification",
      title,
      message,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      attemptCount: 1,
      lastAttemptAt: new Date(),
      source: "notification_service",
      triggeredBy: "system",
      metadata: { link: link ?? null, type: "system" },
    }).catch(() => {});
  }
}

/**
 * Notify all admin users: in-app notification for each + Telegram best-effort
 * to admins who have a verified linked chat.
 */
export async function notifyAdmins(title: string, message: string, link?: string): Promise<void> {
  let admins: Recipient[] = [];
  try {
    admins = await prisma.user.findMany({
      where: { role: "admin", isBlocked: false },
      select: { id: true, telegramChatId: true, telegramVerified: true },
    });
  } catch (err) {
    logger.error({ msg: "Failed to look up admins for notification", error: err });
    return;
  }

  for (const admin of admins) {
    await createInAppNotification(admin.id, title, message, link);
    if (isTelegramDeliveryPossible(admin)) {
      await sendAlertToUser(admin.telegramChatId!, title, message, link, {
        notificationType: "admin_notification",
        source: "notification_service",
        triggeredBy: "system",
        recipientType: "user",
        recipientId: String(admin.id),
        metadata: { adminId: admin.id, link: link ?? null },
      }).catch((err) =>
        logger.warn({ msg: "Admin Telegram notify failed", adminId: admin.id, error: err })
      );
    }
  }
}

/**
 * Notify a specific user: in-app notification + Telegram best-effort if they
 * have a verified linked chat. Never include secrets (passwords) in message.
 */
export async function notifyUser(
  userId: number,
  title: string,
  message: string,
  link?: string
): Promise<{ telegramSent: boolean }> {
  let user: Recipient | null = null;
  try {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, telegramChatId: true, telegramVerified: true },
    });
  } catch (err) {
    logger.error({ msg: "Failed to look up user for notification", userId, error: err });
  }

  await createInAppNotification(userId, title, message, link);

  if (isTelegramDeliveryPossible(user)) {
    const ok = await sendAlertToUser(user.telegramChatId!, title, message, link, {
      notificationType: "user_notification",
      source: "notification_service",
      triggeredBy: "system",
      recipientType: "user",
      recipientId: String(userId),
      metadata: { userId, link: link ?? null },
    }).catch((err) => {
      logger.warn({ msg: "User Telegram notify failed", userId, error: err });
      return false;
    });
    return { telegramSent: ok };
  }
  return { telegramSent: false };
}