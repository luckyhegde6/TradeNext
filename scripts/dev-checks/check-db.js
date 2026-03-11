import { db } from "../lib/prisma";
import logger from "../lib/logger";

async function checkUsers() {
  try {
    const count = await db.user.count();
    console.log("Total users in database:", count);
    
    const users = await db.user.findMany({
      select: { id: true, email: true, role: true }
    });
    console.log("Users:", users);
   } catch (error) {
     console.error("Error connecting to database:", error.message);
     logger.error({ msg: "Database check failed", error: error.message });
   } finally {
    await db.$disconnect();
  }
}

checkUsers();
