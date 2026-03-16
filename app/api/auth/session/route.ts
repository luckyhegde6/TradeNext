import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/auth/session
 * Returns current session status - used for client-side session checking
 */
export async function GET() {
  try {
    const session = await auth();
    
    if (!session || !session.user) {
      return NextResponse.json({ 
        valid: false, 
        authenticated: false 
      }, { status: 200 });
    }
    
    return NextResponse.json({ 
      valid: true, 
      authenticated: true,
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role: session.user.role
      }
    });
  } catch (error) {
    logger.error({ msg: "Session check error", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ 
      valid: false, 
      authenticated: false,
      error: "Session check failed"
    }, { status: 200 });
  }
}
