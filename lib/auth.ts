import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import prisma from "@/lib/prisma";
import { authConfig } from "./auth.config";

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

        if (!email || !password) {
          throw new Error("Missing credentials");
        }

        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user || !user.password) {
          throw new Error("Invalid credentials");
        }

        if ((user as any).isBlocked) {
          throw new Error("Account is blocked. Please contact support.");
        }

        if (!(user as any).isVerified) {
          throw new Error("Email not verified");
        }

        const isPasswordValid = await compare(password, user.password);

        if (!isPasswordValid) {
          throw new Error("Invalid credentials");
        }

        return {
          id: user.id.toString(),
          email: user.email,
          name: user.name,
          role: user.role,
          mobile: (user as any).mobile,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      const tokenExt = token as unknown as { role?: string; id?: string; mobile?: string | null; name?: string };
      
      if (user) {
        tokenExt.role = user.role;
        tokenExt.id = user.id;
        tokenExt.mobile = user.mobile ?? null;
      }

      if (trigger === "update" && session) {
        tokenExt.name = session.name;
        tokenExt.mobile = session.mobile;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.role = token.role as string;
        session.user.id = token.id as string;
        session.user.mobile = token.mobile as string | null;
        session.user.name = (token.name as string | null) || undefined;
      }
      return session;
    },
  },
});
