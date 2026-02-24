import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  createAlert,
  getUserAlerts,
  markAlertSeen,
  markAllAlertsSeen,
  deleteAlert,
  getAlertCount,
  AlertType,
  AlertCondition,
} from "@/lib/services/alertService";

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
      const count = await getAlertCount(userId);
      return NextResponse.json({ count });
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
      return NextResponse.json({ success: true });
    }

    const alerts = await getUserAlerts(userId);
    return NextResponse.json(alerts);
  } catch (error) {
    console.error("Error fetching alerts:", error);
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
    ];

    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid alert type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const alert = await createAlert(userId, type, symbol, condition);
    return NextResponse.json(alert, { status: 201 });
  } catch (error) {
    console.error("Error creating alert:", error);
    return NextResponse.json({ error: "Failed to create alert" }, { status: 500 });
  }
}
