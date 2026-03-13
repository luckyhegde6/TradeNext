import { signOut, auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import logger from "@/lib/logger";

export async function GET() {
  logger.info({ msg: "Auth: SignOut GET called" });
  
  try {
    const session = await auth();
    logger.info({ msg: "Auth: SignOut - current session", hasSession: !!session?.user, email: session?.user?.email });
    
    await signOut({ redirect: false });
    
    logger.info({ msg: "Auth: SignOut completed successfully" });
    
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
    const session = await auth();
    logger.info({ msg: "Auth: SignOut POST - current session", hasSession: !!session?.user, email: session?.user?.email });
    
    await signOut({ redirect: false });
    
    logger.info({ msg: "Auth: SignOut POST completed successfully" });
    
    return NextResponse.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    logger.error({ msg: "Auth: SignOut POST error", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: "Logout failed" }, { status: 500 });
  }
}
