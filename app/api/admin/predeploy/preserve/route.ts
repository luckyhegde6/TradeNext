// app/api/admin/predeploy/preserve/route.ts
//
// Predeploy mirror-preservation guard (v3.40.3, spec 14).
//
// POST — snapshot → versioned backup → attempt SQLite→Prisma push (in that
//        exact order: a crash mid-push still leaves a complete backup).
//        Returns the mode used: "pushed" | "backed_up" | "skipped".
// GET  — read-only status (pending outbox, breaker state, existing backups).
//
// Auth is dual: `x-deploy-guard-token` (compared length-checked + timing-safe,
// never early-exit string-compared) OR a standard admin session. When
// DEPLOY_GUARD_TOKEN is unset, token callers get 503 — never open access.
//
// This route performs no Prisma writes of its own: it drains an existing,
// already-authorized outbox through the existing guarded push path.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { auth } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { isPlanLimitBreakerOpen } from "@/lib/db-utils";
import logger from "@/lib/logger";
import {
  exportSqliteBackup,
  getOutboxPending,
  getSqliteFallback,
  persistMirrorSnapshot,
  pushSqliteToPrisma,
  uploadMirrorSnapshotToBlobs,
} from "@/lib/sqlite";
import {
  MIRROR_BACKUP_KEEP,
  createMirrorBackup,
  listMirrorBackups,
} from "@/lib/services/mirrorBackup";

export const runtime = "nodejs"; // crypto + node:fs + Prisma underneath
export const dynamic = "force-dynamic";

type Authz =
  | { ok: true; via: "token"; sessionUserId?: undefined }
  | { ok: true; via: "session"; sessionUserId?: number }
  | { ok: false; status: 401 | 503 };

/** Length-checked, timing-safe token comparison — no early-exit string compare. */
function tokenMatches(provided: string): boolean {
  const expected = process.env.DEPLOY_GUARD_TOKEN;
  if (!expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function authorize(req: NextRequest): Promise<Authz> {
  const token = req.headers.get("x-deploy-guard-token");
  const hasTokenEnv = Boolean(process.env.DEPLOY_GUARD_TOKEN);

  if (token && hasTokenEnv && tokenMatches(token)) {
    return { ok: true, via: "token" };
  }

  // Admin-session fallback (mirrors workers/status route:53-56).
  try {
    const session = await auth();
    if (session?.user?.role === "admin") {
      const rawId = session.user.id;
      const id = rawId != null ? parseInt(String(rawId), 10) : undefined;
      return { ok: true, via: "session", sessionUserId: Number.isFinite(id) ? id : undefined };
    }
  } catch (err) {
    logger.warn({
      msg: "predeploy preserve: session auth failed, falling back to token-only",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // A token presented while the env var is unset is a configuration gap,
  // not an authentication failure — 503 so the build script can warn+skip.
  if (token && !hasTokenEnv) return { ok: false, status: 503 };
  return { ok: false, status: 401 };
}

function pendingTotal(pending: Record<string, { pending: number; lastAt?: string }>): number {
  return Object.values(pending).reduce((n, x) => n + x.pending, 0);
}

// POST — preserve (snapshot first, then backup, then push)
export async function POST(req: NextRequest) {
  const atStart = Date.now();
  const authz = await authorize(req);
  if (!authz.ok) {
    if (authz.status === 503) {
      logger.warn({ msg: "predeploy preserve: DEPLOY_GUARD_TOKEN not configured, refusing token caller" });
      return NextResponse.json({ error: "guard_token_not_configured" }, { status: 503 });
    }
    logger.warn({ msg: "predeploy preserve: unauthorized" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. Standing outbox counts BEFORE any drain.
  const pendingBefore = getOutboxPending();
  const pendingBeforeTotal = pendingTotal(pendingBefore);

  // 2. Snapshot (disk + canonical Blobs) — fail-open, never throws.
  const persisted = persistMirrorSnapshot();
  const bytes = exportSqliteBackup();
  let snapshotBytes: number | null = bytes?.byteLength ?? null;
  if (!persisted || !bytes) {
    logger.warn({ msg: "predeploy preserve: snapshot empty — SQLite not ready or export failed", persisted });
    snapshotBytes = null;
  } else {
    try {
      await uploadMirrorSnapshotToBlobs(bytes);
    } catch (err) {
      logger.warn({ msg: "predeploy preserve: canonical Blobs upload failed (fail-open)", error: err instanceof Error ? err.message : String(err) });
    }
  }

  // 3. Versioned point-in-time backup (unconditional — survives any later push failure).
  const backup = await createMirrorBackup(snapshotBytes !== null ? bytes : null);

  // 4. Drain the outbox when Prisma is not on hold.
  let mode: "pushed" | "backed_up" | "skipped" = "skipped";
  let pushed = false;
  let synced = 0;
  let failed = 0;
  const breakerOpen = isPlanLimitBreakerOpen();
  let pushError: string | null = null;

  if (breakerOpen) {
    mode = "backed_up";
  } else {
    try {
      const res = await pushSqliteToPrisma({ reason: "deploy", leaderGate: false });
      if (res) {
        pushed = res.ran;
        synced = res.synced;
        failed = res.failed;
        mode = res.ran ? "pushed" : "skipped";
      }
      // res === null → SQLite not ready / already syncing → mode stays "skipped"
    } catch (err) {
      pushError = err instanceof Error ? err.message : String(err);
      logger.error({ msg: "predeploy preserve: push failed after snapshot+backup", error: pushError });
      return NextResponse.json(
        {
          success: false,
          error: "push_failed",
          detail: pushError,
          mode: "skipped",
          snapshotBytes,
          backupKey: backup?.key ?? null,
          pendingBefore,
        },
        { status: 500 },
      );
    }
  }

  // 5. Audit the state-changing POST (best-effort; never fails the response).
  try {
    await createAuditLog({
      action: "ADMIN_DB_SYNC",
      resource: "predeploy-preserve",
      method: "POST",
      path: "/api/admin/predeploy/preserve",
      responseStatus: 200,
      responseTime: Date.now() - atStart,
      userId: authz.sessionUserId,
      metadata: { via: authz.via, mode, pushed, synced, failed, pendingBeforeTotal, backupKey: backup?.key ?? null },
    });
  } catch (err) {
    logger.warn({ msg: "predeploy preserve: audit log failed (non-fatal)", error: err instanceof Error ? err.message : String(err) });
  }

  const pushedMessage =
    mode === "pushed"
      ? `Pushed ${synced} rows to Prisma (${failed} failed)`
      : mode === "backed_up"
        ? `Prisma plan-limit breaker open — mirror preserved as a versioned backup (${pendingBeforeTotal} rows pending)`
        : "SQLite not ready — mirror state unchanged";

  logger.info({ msg: "predeploy preserve: complete", mode, pushed, synced, failed, snapshotBytes, backupKey: backup?.key ?? null });

  return NextResponse.json({
    success: true,
    mode,
    pendingBefore,
    snapshotBytes,
    backupKey: backup?.key ?? null,
    pruned: backup?.pruned ?? [],
    pushed,
    synced,
    failed,
    breakerOpen,
    message: pushedMessage,
  });
}

// GET — read-only status; performs no writes and never pushes.
export async function GET(req: NextRequest) {
  const authz = await authorize(req);
  if (!authz.ok) {
    if (authz.status === 503) return NextResponse.json({ error: "guard_token_not_configured" }, { status: 503 });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pending = getOutboxPending();
  const breakerOpen = isPlanLimitBreakerOpen();
  const backups = await listMirrorBackups();

  return NextResponse.json({
    success: true,
    breakerOpen,
    sqliteReady: getSqliteFallback() !== null,
    pending,
    backups,
    keep: MIRROR_BACKUP_KEEP,
  });
}