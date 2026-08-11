import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import { authConfig } from "./auth.config";
import { createAuditLog } from "./audit";
import { createUserSession, invalidateSession } from "./services/sessionService";
import logger from "./logger";

// Set runtime to nodejs since we use cookies API
export const runtime = 'nodejs';

// Tasks:
// [x] Implement standard NextAuth sign-out flow
// [x] Remove redundant custom logout API routes
// [x] Fix auto-login issue with "Nuclear Option" (Cookie Renaming)
// [ ] Verify fix with Playwright
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

// Derive a short device label from the user-agent (no external parser needed)
function deriveDeviceInfo(ua?: string): string | undefined {
  if (!ua) return undefined;
  const os =
    /Windows/i.test(ua) ? "Windows" :
    /Mac OS X/i.test(ua) ? "macOS" :
    /Android/i.test(ua) ? "Android" :
    /iPhone|iPad|iOS/i.test(ua) ? "iOS" :
    /Linux/i.test(ua) ? "Linux" :
    "Other";
  const browser =
    /Edg\//i.test(ua) ? "Edge" :
    /Chrome\//i.test(ua) ? "Chrome" :
    /Firefox\//i.test(ua) ? "Firefox" :
    /Safari\//i.test(ua) ? "Safari" :
    "Other";
  return `${browser} on ${os}`;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  session: {
    ...authConfig.session,
    strategy: "jwt",
  },
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

          // Email-verification gate removed — approved join-request users and
          // admin-created users log in directly with their password.
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
          };
        } catch (error) {
          logger.error({ msg: "Auth: Login error", email, error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.mobile = user.mobile;

        // Persist a DB session row so /admin/sessions can track active sessions (#69)
        try {
          const h = await headers();
          const ip =
            h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            h.get("x-real-ip") ||
            undefined;
          const ua = h.get("user-agent") || undefined;
          const sessionToken = await createUserSession({
            userId: parseInt(user.id, 10),
            ipAddress: ip,
            userAgent: ua,
            deviceInfo: deriveDeviceInfo(ua),
          });
          token.dbSessionToken = sessionToken;
        } catch (error) {
          logger.error({
            msg: "Auth: Failed to persist DB session",
            userId: user.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.mobile = token.mobile as string | null;
      }
      return session;
    },
  },
  events: {
    async signIn({ user }) {
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
    async signOut(params: any) {
      const token = params.token;
      // Invalidate the persisted DB session when the user signs out (#69)
      if (token?.dbSessionToken) {
        try {
          await invalidateSession(token.dbSessionToken as string);
        } catch (error) {
          logger.error({ msg: "Auth: Failed to invalidate DB session", error: error instanceof Error ? error.message : String(error) });
        }
      }
      // Create audit log
      try {
        if (token?.id) {
          await createAuditLog({
            userId: parseInt(token.id as string),
            action: 'LOGOUT',
          });
        }
      } catch (error) {
        logger.error({ msg: "Auth: Failed to create logout audit log", error: error instanceof Error ? error.message : String(error) });
      }
    },
  },
});
