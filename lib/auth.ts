import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import prisma from "@/lib/prisma";
import { authConfig } from "./auth.config";
import { createAuditLog } from "./audit";
import { createUserSession, invalidateSession } from "./services/sessionService";
import logger from "./logger";
import { cookies } from "next/headers";

// Set runtime to nodejs since we use cookies API
export const runtime = 'nodejs';

declare module "next-auth" {
  interface User {
    role: string;
    id: string;
    mobile?: string | null;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name?: string;
      mobile?: string | null;
      role: string;
    };
  }
}

// Helper to get request info
async function getRequestInfo() {
  const cookieStore = await cookies();
  const headers = cookieStore.getAll();
  
  // Get user agent and IP from headers (if available)
  const userAgent = headers.find(h => h.name === 'user-agent')?.value || 'Unknown';
  const ipAddress = headers.find(h => h.name === 'x-forwarded-for')?.value?.split(',')[0] || 
                    headers.find(h => h.name === 'x-real-ip')?.value || 
                    '127.0.0.1';
  
  // Parse device info
  let deviceInfo = 'Unknown';
  if (userAgent.includes('Chrome')) deviceInfo = 'Chrome';
  else if (userAgent.includes('Firefox')) deviceInfo = 'Firefox';
  else if (userAgent.includes('Safari')) deviceInfo = 'Safari';
  else if (userAgent.includes('Edge')) deviceInfo = 'Edge';
  
  if (userAgent.includes('Mobile')) deviceInfo += ' (Mobile)';
  else if (userAgent.includes('Tablet')) deviceInfo += ' (Tablet)';
  else deviceInfo += ' (Desktop)';
  
  return { userAgent, ipAddress, deviceInfo };
}


export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials.email as string | undefined;
        const password = credentials.password as string | undefined;

        logger.info({ msg: "Auth: Attempting login", email });

        if (!email || !password) {
          logger.warn({ msg: "Auth: Missing credentials" });
          throw new Error("Missing credentials");
        }

        try {
          const user = await prisma.user.findUnique({
            where: { email },
          });

          if (!user || !user.password) {
            logger.warn({ msg: "Auth: User not found", email });
            throw new Error("Invalid credentials");
          }

          if ((user as any).isBlocked) {
            logger.warn({ msg: "Auth: Account blocked", email });
            throw new Error("Account is blocked. Please contact support.");
          }

          if (!(user as any).isVerified) {
            logger.warn({ msg: "Auth: Email not verified", email });
            throw new Error("Email not verified");
          }

          const isPasswordValid = await compare(password, user.password);

          if (!isPasswordValid) {
            logger.warn({ msg: "Auth: Invalid password", email });
            throw new Error("Invalid credentials");
          }

          logger.info({ msg: "Auth: Login successful", email, userId: user.id });
          
          return {
            id: user.id.toString(),
            email: user.email,
            name: user.name,
            role: user.role,
            mobile: (user as any).mobile,
            tokenVersion: (user as any).tokenVersion,
          };
        } catch (error) {
          logger.error({ msg: "Auth: Login error", email, error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      const tokenExt = token as unknown as { 
        role?: string; 
        id?: string; 
        mobile?: string | null; 
        name?: string;
        tokenVersion?: number;
        isValid?: boolean;
      };

      if (user) {
        logger.debug({ msg: "Auth: JWT callback - adding user to token", userId: user.id });
        tokenExt.role = user.role;
        tokenExt.id = user.id;
        tokenExt.mobile = user.mobile ?? null;
        // Include token version in JWT
        tokenExt.tokenVersion = (user as any).tokenVersion || 1;
        tokenExt.isValid = true;
      }

      // Check token version on each request - if user exists in token, verify version
      if (tokenExt.id && !user && tokenExt.isValid) {
        // This is a refresh/callback - check if token version is still valid
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: parseInt(tokenExt.id) },
            select: { tokenVersion: true, isBlocked: true, isVerified: true }
          });
          
          if (!dbUser) {
            logger.warn({ msg: "Auth: User not found in DB during token refresh", userId: tokenExt.id });
            throw new Error("Session invalidated");
          }
          
          if (dbUser.isBlocked) {
            logger.warn({ msg: "Auth: User blocked - invalidating token", userId: tokenExt.id });
            throw new Error("Account blocked");
          }
          
          if (!dbUser.isVerified) {
            logger.warn({ msg: "Auth: User not verified - invalidating token", userId: tokenExt.id });
            throw new Error("Email not verified");
          }
          
          // Check token version - if different, token is invalidated
          if (dbUser.tokenVersion !== tokenExt.tokenVersion) {
            logger.warn({ msg: "Auth: Token version mismatch - session invalidated", userId: tokenExt.id, dbVersion: dbUser.tokenVersion, tokenVersion: tokenExt.tokenVersion });
            throw new Error("Session invalidated");
          }
        } catch (error) {
          // If there's an error (including our custom errors), invalidate the token
          if (error instanceof Error && error.message.includes("Session") || error instanceof Error && error.message.includes("blocked")) {
            // Return a token with isValid = false to signal invalidation
            tokenExt.isValid = false;
          }
          logger.error({ msg: "Auth: Error checking token version", error: error instanceof Error ? error.message : String(error) });
        }
      }

      if (trigger === "update" && session) {
        logger.debug({ msg: "Auth: JWT callback - updating token from session" });
        tokenExt.name = session.name;
        tokenExt.mobile = session.mobile;
      }
      return token;
    },
    async session({ session, token }) {
      const tokenExt = token as unknown as { isValid?: boolean };
      
      // If token was invalidated, return empty session
      if (tokenExt.isValid === false) {
        return { 
          ...session,
          user: {
            id: '',
            email: '',
            role: '',
          }
        };
      }
      
      logger.debug({ msg: "Auth: Session callback", hasToken: !!token, hasSession: !!session });
      if (token && session.user) {
        session.user.role = token.role as string;
        session.user.id = token.id as string;
        session.user.mobile = token.mobile as string | null;
        session.user.name = (token.name as string | null) || undefined;
      }
      return session;
    },
  },
  events: {
    async signIn({ user, account, profile }) {
      logger.info({ 
        msg: "Auth: User signed in", 
        userId: user?.id, 
        email: user?.email,
        provider: account?.provider 
      });

      // Create session in database
      if (user?.id) {
        try {
          // Try to get request info, but don't fail if we can't
          let ipAddress = 'unknown';
          let userAgent = 'unknown';
          let deviceInfo = 'Desktop';
          
          try {
            const { userAgent: ua, ipAddress: ip, deviceInfo: di } = await getRequestInfo();
            ipAddress = ip;
            userAgent = ua;
            deviceInfo = di;
          } catch (e) {
            // Request info not available, use defaults
          }
          
          await createUserSession({
            userId: parseInt(user.id),
            ipAddress,
            userAgent,
            deviceInfo,
          });
          
          logger.info({ 
            msg: "Auth: Session created in database", 
            userId: user.id,
            ipAddress
          });
        } catch (error) {
          logger.error({ 
            msg: "Auth: Failed to create session in DB", 
            userId: user.id,
            error: error instanceof Error ? error.message : String(error) 
          });
          // Continue with login even if session creation fails
        }
      }

      // Create audit log
      if (user?.id) {
        try {
          await createAuditLog({
            userId: parseInt(user.id),
            userEmail: user.email || undefined,
            action: 'LOGIN',
          });
        } catch (error) {
          logger.error({ msg: "Auth: Failed to create audit log", error: error instanceof Error ? error.message : String(error) });
        }
      }
    },
    async signOut(message: any) {
      logger.info({ msg: "Auth: SignOut event", session: message.session?.user?.email });
      
      // Invalidate session in database
      if (message.token?.sub) {
        try {
          // Get the session token from the cookie if available
          const cookieStore = await cookies();
          const sessionToken = cookieStore.get('next-auth.session-token')?.value;
          
          if (sessionToken) {
            await invalidateSession(sessionToken);
            logger.info({ msg: "Auth: Session invalidated in DB", userId: message.token.sub });
          }
        } catch (error) {
          logger.error({ 
            msg: "Auth: Failed to invalidate session", 
            error: error instanceof Error ? error.message : String(error) 
          });
        }
      }

      // Create audit log
      try {
        if (message.session?.user?.id) {
          await createAuditLog({
            session: message.session,
            action: 'LOGOUT',
          });
        }
      } catch (error) {
        logger.error({ msg: "Auth: Failed to create logout audit log", error: error instanceof Error ? error.message : String(error) });
      }
    },
  },
});
