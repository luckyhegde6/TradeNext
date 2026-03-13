import { signOut, auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import logger from "@/lib/logger";

const isProduction = process.env.NODE_ENV === "production";

export async function GET() {
  logger.info({ msg: "Auth: SignOut GET called" });
  
  try {
    const session = await auth();
    logger.info({ msg: "Auth: SignOut - current session", hasSession: !!session?.user, email: session?.user?.email });
    
    await signOut({ redirect: false });
    
    logger.info({ msg: "Auth: SignOut completed successfully" });
    
    const response = NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"), {
      status: 302,
    });
    
    // Explicitly clear the session cookie
    const cookieName = isProduction ? "__Secure-next-auth.session-token" : "next-auth.session-token";
    response.cookies.delete(cookieName);
    response.cookies.delete("next-auth.callback-url");
    response.cookies.delete("next-auth.csrf-token");
    
    return response;
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
    const session = await auth();
    logger.info({ msg: "Auth: SignOut POST - current session", hasSession: !!session?.user, email: session?.user?.email });
    
    await signOut({ redirect: false });
    
    logger.info({ msg: "Auth: SignOut POST completed successfully" });
    
    // Create response and explicitly clear all session cookies
    const response = NextResponse.json({ success: true, message: "Logged out successfully" });
    
    const cookieName = isProduction ? "__Secure-next-auth.session-token" : "next-auth.session-token";
    response.cookies.delete(cookieName);
    response.cookies.delete("next-auth.callback-url");
    response.cookies.delete("next-auth.csrf-token");
    
    return response;
  } catch (error) {
    logger.error({ msg: "Auth: SignOut POST error", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: "Logout failed" }, { status: 500 });
  }
}
