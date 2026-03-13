import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import prisma from "@/lib/prisma";
import { authConfig } from "./auth.config";
import { createAuditLog } from "./audit";
import logger from "./logger";

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
    async jwt({ token, user, trigger, session }) {
      const tokenExt = token as unknown as { role?: string; id?: string; mobile?: string | null; name?: string };

      if (user) {
        logger.debug({ msg: "Auth: JWT callback - adding user to token", userId: user.id });
        tokenExt.role = user.role;
        tokenExt.id = user.id;
        tokenExt.mobile = user.mobile ?? null;
      }

      if (trigger === "update" && session) {
        logger.debug({ msg: "Auth: JWT callback - updating token from session" });
        tokenExt.name = session.name;
        tokenExt.mobile = session.mobile;
      }
      return token;
    },
    async session({ session, token }) {
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
    async signIn({ user }) {
      logger.info({ msg: "Auth: SignIn event", userId: user?.id, email: user?.email });
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
