import { signOut } from "next-auth/react";
import { NextResponse } from "next/server";
import logger from "@/lib/logger";

export async function GET() {
  logger.info({ msg: "Auth: SignOut GET called" });
  
  try {
    // Use NextAuth's signOut - it handles cookie clearing internally
    await signOut({ redirect: false });
    
    logger.info({ msg: "Auth: SignOut completed successfully" });
    
    // Redirect to home
    return NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"), {
      status: 302,
    });
  } catch (error) {
    logger.error({ msg: "Auth: SignOut error", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"), {
      status: 302,
    });
  }
}

export async function POST() {
  logger.info({ msg: "Auth: SignOut POST called" });
  
  try {
    // Use NextAuth's signOut - it handles cookie clearing internally
    await signOut({ redirect: false });
    
    logger.info({ msg: "Auth: SignOut completed successfully" });
    
    // Return success JSON - browser should clear the cookie
    return NextResponse.json({ success: true, message: "Logged out successfully" }, { status: 200 });
  } catch (error) {
    logger.error({ msg: "Auth: SignOut POST error", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: "Logout failed" }, { status: 500 });
  }
}
