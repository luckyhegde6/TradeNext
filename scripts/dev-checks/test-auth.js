import { db } from "../lib/prisma";
import { compare } from "bcryptjs";

async function testAuth() {
  try {
    const email = "demo@tradenext6.app";
    const password = process.env.DEMO_PASSWORD;

    console.log(`Looking up user with email: ${email}`);
    const user = await db.user.findUnique({
      where: { email },
    });

    if (!user) {
      console.log("❌ User not found!");
      return;
    }

    console.log("✅ User found:", { id: user.id, email: user.email, role: user.role, isVerified: user.isVerified, hasPassword: !!user.password });

    if (!user.password) {
      console.log("❌ User has no password set!");
      return;
    }

    console.log("Stored password hash:", user.password.substring(0, 20) + "...");

    const isMatch = await compare(password, user.password);
    console.log("Password comparison result:", isMatch ? "✅ MATCH" : "❌ NO MATCH");

    if (isMatch) {
      console.log("Auth should work!");
    } else {
      console.log("Auth failing due to password mismatch.");
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await db.$disconnect();
  }
}

testAuth();
