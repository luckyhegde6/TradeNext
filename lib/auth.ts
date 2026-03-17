import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import prisma from "@/lib/prisma";
import { authConfig } from "./auth.config";
import { createAuditLog } from "./audit";
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
