// app/api/admin/decision/ping/route.ts
// ph22 Decision engine — admin liveness/config probe (admin-only GET).
// Returns the resolved provider mode, provider list, health detail, and the
// POC A/B env flags. Never touches the engine providers on the inert path.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDecisionClient } from "@/lib/services/decision/client";
import logger from "@/lib/logger";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ success: false, error: "Admin only" }, { status: 401 });
  }

  const client = getDecisionClient();
  const ping = await client.ping();
  const pocEnabled = process.env.DECISION_POC_ENABLED === "true";

  logger.info({
    msg: "Decision engine ping",
    mode: ping.mode,
    providers: ping.providers,
    pocEnabled,
  });

  return NextResponse.json({
    success: true,
    ping,
    flags: {
      DECISION_PROVIDER: ping.mode,
      DECISION_POC_ENABLED: pocEnabled,
    },
  });
}