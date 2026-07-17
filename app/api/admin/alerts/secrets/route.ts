import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import crypto from "crypto";

export const runtime = "nodejs";

// ============================================================
// Encryption helpers (AES-256-GCM)
// ============================================================

const ALGORITHM = "aes-256-gcm";
const ENCRYPTION_KEY = process.env.SECRETS_ENCRYPTION_KEY || process.env.AUTH_SECRET;
if (!ENCRYPTION_KEY) {
  throw new Error(
    "SECRETS_ENCRYPTION_KEY (or AUTH_SECRET) environment variable must be set for secrets encryption"
  );
}

function deriveKey(seed: string | undefined): Buffer {
  // Derive a 32-byte key using SHA-256 (seed is always defined, checked at module init)
  return crypto.createHash("sha256").update(seed!).digest();
}

function encrypt(plaintext: string): string {
  const key = deriveKey(ENCRYPTION_KEY);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  // Format: iv:authTag:ciphertext (all hex)
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

function decrypt(encryptedText: string): string {
  const key = deriveKey(ENCRYPTION_KEY);
  const parts = encryptedText.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format");
  const [ivHex, authTagHex, ciphertext] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function maskValue(value: string): string {
  if (value.length <= 8) return value.slice(0, 2) + "****";
  return value.slice(0, 4) + "****" + value.slice(-4);
}

// ============================================================
// API Routes
// ============================================================

/**
 * GET /api/admin/alerts/secrets — list all encrypted secrets (with masked values)
 * Query: type (optional filter)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const url = new URL(req.url);
    const type = url.searchParams.get("type");
    const showValue = url.searchParams.get("showValue") === "true";

    const where: any = {};
    if (type) where.type = type;

    const secrets = await prisma.secret.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    // Decrypt values only if explicitly requested (for copy/paste use)
    const result = secrets.map((s) => ({
      ...s,
      value: showValue ? decrypt(s.value) : maskValue(s.value),
    }));

    return NextResponse.json({ secrets: result });
  } catch (error) {
    logger.error({
      msg: "Admin: Failed to list secrets",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to list secrets" }, { status: 500 });
  }
}

/**
 * POST /api/admin/alerts/secrets — create a new encrypted secret
 * Body: { name, type, value, hint?, metadata? }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json();
    const { name, type, value, hint, metadata } = body;

    if (!name || !type || !value) {
      return NextResponse.json(
        { error: "name, type, and value are required" },
        { status: 400 }
      );
    }

    // Check for duplicate name
    const existing = await prisma.secret.findUnique({ where: { name } });
    if (existing) {
      return NextResponse.json(
        { error: `Secret with name "${name}" already exists` },
        { status: 409 }
      );
    }

    const encrypted = encrypt(value);

    const secret = await prisma.secret.create({
      data: {
        name,
        type,
        value: encrypted,
        hint: hint || maskValue(value),
        metadata: metadata || {},
      },
    });

    logger.info({
      msg: "Admin: Secret created",
      name: secret.name,
      type: secret.type,
    });

    return NextResponse.json(
      { ...secret, value: maskValue(secret.value) },
      { status: 201 }
    );
  } catch (error) {
    logger.error({
      msg: "Admin: Failed to create secret",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to create secret" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/alerts/secrets — update a secret value or metadata
 * Body: { id, name?, value?, hint?, metadata?, isActive? }
 */
export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json();
    const { id, name, value, hint, metadata, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const data: any = {};
    if (name !== undefined) data.name = name;
    if (value !== undefined) data.value = encrypt(value);
    if (hint !== undefined) data.hint = hint;
    if (metadata !== undefined) data.metadata = metadata;
    if (isActive !== undefined) data.isActive = isActive;

    const secret = await prisma.secret.update({
      where: { id },
      data,
    });

    logger.info({
      msg: "Admin: Secret updated",
      name: secret.name,
    });

    return NextResponse.json({ ...secret, value: maskValue(secret.value) });
  } catch (error) {
    logger.error({
      msg: "Admin: Failed to update secret",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to update secret" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/alerts/secrets?id=xxx — delete a secret
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const url = new URL(req.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id query param is required" }, { status: 400 });
    }

    const secret = await prisma.secret.delete({ where: { id } });
    logger.info({
      msg: "Admin: Secret deleted",
      name: secret.name,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({
      msg: "Admin: Failed to delete secret",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to delete secret" }, { status: 500 });
  }
}
