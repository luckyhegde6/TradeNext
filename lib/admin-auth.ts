import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function requireAdmin() {
  const session = await auth();
  
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden - Admin access required" }, { status: 403 });
  }

  return null;
}

export async function getAdminSession() {
  const session = await auth();
  
  if (!session || !session.user || session.user.role !== "admin") {
    return null;
  }

  return session;
}
