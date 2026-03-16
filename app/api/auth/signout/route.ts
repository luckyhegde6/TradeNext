import { signOut } from "next-auth/react";
import { NextResponse } from "next/server";
import logger from "@/lib/logger";

export async function GET() {
  logger.info({ msg: "Auth: SignOut GET called" });
  
  try {
    // Let NextAuth handle the signout and redirect
    // This properly clears the JWT cookie
    await signOut({ redirect: false });
    
    logger.info({ msg: "Auth: SignOut completed" });
    
    // Redirect to home page
    return NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_APP_URL || "https://tradenext6.netlify.app"), {
      status: 302,
    });
  } catch (error) {
    logger.error({ msg: "Auth: SignOut error", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_APP_URL || "https://tradenext6.netlify.app"), {
      status: 302,
    });
  }
}

export async function POST() {
  logger.info({ msg: "Auth: SignOut POST called" });
  
  try {
    // Let NextAuth handle the signout
    await signOut({ redirect: false });
    
    logger.info({ msg: "Auth: SignOut completed" });
    
    // Return success - client should redirect
    return NextResponse.json({ success: true, url: "/" });
  } catch (error) {
    logger.error({ msg: "Auth: SignOut error", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: "Logout failed" }, { status: 500 });
  }
}
