import { NextResponse } from "next/server";

// Legacy self-signup endpoint — DISABLED (v3.6.0).
// All new users must go through the admin-moderated join-request flow so
// account provisioning stays gated and no user picks their own password
// on signup. Directing callers to the join-request page.
export async function POST() {
  return NextResponse.json(
    {
      error: "Self-signup is disabled. Request access via the join flow instead.",
      redirectTo: "/auth/join",
    },
    { status: 410 }
  );
}