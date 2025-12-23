// lib/alerts.ts
import { prisma } from "@/lib/prisma";

export async function checkGainerAlerts(data: any[]) {
  for (const row of data) {
    if (row.pChange > 5) {
      await prisma.alert.create({
        data: {
          type: "price_jump",
          symbol: row.symbol,
          condition: { pChange: row.pChange },
        },
      });
    }
  }
}
