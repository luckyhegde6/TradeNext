import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  createAlert,
  getUserAlerts,
  markAlertSeen,
  markAllAlertsSeen,
  deleteAlert,
  getAlertCount,
  updateAlert,
  AlertType,
  AlertCondition,
} from "@/lib/services/alertService";
import { createAuditLog } from "@/lib/audit";
import logger from "@/lib/logger";
import { isDbUnavailableError } from "@/lib/db-utils";
import { getSqliteFallback } from "@/lib/sqlite";

/**
 * Mirror fallback for alert reads during a DB outage (BUGS 15).
 * The SQLite `alert` mirror returns rows for ALL users — with camelCase aliases
 * (`userId`, `triggeredAt`, `createdAt`) and `condition` already JSON-parsed —
 * so scope to the session user and coerce booleans here.
 */
function getMirrorAlerts(userId: number): Array<Record<string, unknown>> {
  const sqlite = getSqliteFallback();
  if (!sqlite?.isReady()) return [];

  return sqlite
    .getAlerts({ limit: 500 })
    .filter((row) => Number(row.userId) === userId)
    .map((row) => ({
      id: String(row.id ?? ""),
      type: String(row.type ?? ""),
      symbol: row.symbol ?? null,
      condition: row.condition ?? {},
      triggered: Boolean(row.triggered),
      triggeredAt: row.triggeredAt ?? null,
      seen: Boolean(row.seen),
      createdAt: row.createdAt ?? null,
    }));
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id);
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const alertId = url.searchParams.get("id");

    if (action === "count") {
      try {
        const count = await getAlertCount(userId);
        return NextResponse.json({ count });
      } catch (error) {
        if (isDbUnavailableError(error)) {
          const mirrored = getMirrorAlerts(userId);
          logger.warn({ msg: "Alerts: DB unavailable — count from SQLite mirror", count: mirrored.length });
          return NextResponse.json({ count: mirrored.length });
        }
        throw error;
      }
    }

    if (action === "markSeen" && alertId) {
      await markAlertSeen(alertId, userId);
      return NextResponse.json({ success: true });
    }

    if (action === "markAllSeen") {
      await markAllAlertsSeen(userId);
      return NextResponse.json({ success: true });
    }

    if (action === "delete" && alertId) {
      await deleteAlert(alertId, userId);

      await createAuditLog({
        userId,
        action: 'ALERT_DELETE',
        resource: 'Alert',
        resourceId: alertId
      });

      return NextResponse.json({ success: true });
    }

    try {
      const alerts = await getUserAlerts(userId);
      return NextResponse.json(alerts);
    } catch (error) {
      if (isDbUnavailableError(error)) {
        const mirrored = getMirrorAlerts(userId);
        logger.warn({ msg: "Alerts: DB unavailable — serving SQLite mirror", count: mirrored.length });
        return NextResponse.json(mirrored);
      }
      throw error;
    }
  } catch (error) {
    logger.error({ msg: "Error fetching alerts", error });
    return NextResponse.json({ error: "Failed to fetch alerts" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id);
    const body = await req.json();

    const { type, symbol, condition } = body as {
      type: AlertType;
      symbol?: string;
      condition: AlertCondition;
    };

    if (!type || !condition) {
      return NextResponse.json(
        { error: "Missing required fields: type and condition" },
        { status: 400 }
      );
    }

    const validTypes: AlertType[] = [
      "price_above",
      "price_below",
      "volume_spike",
      "price_jump",
      "piotroski_score",
      "portfolio_value",
      // Corporate Action Alerts
      "dividend_alert",
      "bonus_alert",
      "split_alert",
      "rights_alert",
      "buyback_alert",
      "meeting_alert",
    ];

    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid alert type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const alert = await createAlert(userId, type, symbol, condition);

    await createAuditLog({
      userId,
      action: 'ALERT_CREATE',
      resource: 'Alert',
      resourceId: alert.id,
      metadata: { type, symbol, condition }
    });

    return NextResponse.json(alert, { status: 201 });
  } catch (error) {
    console.error("Error creating alert:", error);
    return NextResponse.json({ error: "Failed to create alert" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id);
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const alertId = url.searchParams.get("id");

    if (action !== "update" || !alertId) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const body = await req.json();
    const { type, symbol, condition } = body as {
      type: AlertType;
      symbol?: string;
      condition: AlertCondition;
    };

    const validTypes: AlertType[] = [
      "price_above",
      "price_below",
      "volume_spike",
      "price_jump",
      "piotroski_score",
      "portfolio_value",
      // Corporate Action Alerts
      "dividend_alert",
      "bonus_alert",
      "split_alert",
      "rights_alert",
      "buyback_alert",
      "meeting_alert",
    ];

    if (type && !validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid alert type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const alert = await updateAlert(alertId, userId, type, symbol, condition);

    await createAuditLog({
      userId,
      action: 'ALERT_UPDATE',
      resource: 'Alert',
      resourceId: alertId,
      metadata: { type, symbol, condition }
    });

    return NextResponse.json(alert);
  } catch (error) {
    console.error("Error updating alert:", error);
    return NextResponse.json({ error: "Failed to update alert" }, { status: 500 });
  }
}
