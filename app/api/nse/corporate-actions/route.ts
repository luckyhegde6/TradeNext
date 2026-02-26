import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

const databaseUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/tradenext";
const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export async function GET() {
  try {
    const data = await nseFetch(
      "https://www.nseindia.com/api/corporates-corporateActions?index=equities"
    ) as any[];

    const actions = Array.isArray(data) ? data : [];

    const filtered = actions.filter((item: any) => {
      const subject = item.subject?.toLowerCase() || "";
      return (
        subject.includes("dividend") ||
        subject.includes("split") ||
        subject.includes("bonus") ||
        subject.includes("rights") ||
        subject.includes("face value")
      );
    });

    const result = await Promise.all(
      filtered.slice(0, 500).map(async (item: any) => {
        const exDate = parseDate(item.exDate);
        const isUpcoming = isWithinDays(exDate, 7);
        
        let currentPrice = null;
        try {
          const priceData = await prisma.dailyPrice.findFirst({
            where: { ticker: item.symbol },
            orderBy: { tradeDate: "desc" },
            select: { close: true }
          });
          currentPrice = priceData ? Number(priceData.close) : null;
        } catch (e) {
          // Ignore errors
        }

        return {
          symbol: item.symbol || "",
          companyName: item.comp || "",
          series: item.series || "",
          subject: item.subject || "",
          exDate: item.exDate || "",
          recDate: item.recDate || "",
          faceValue: item.faceVal || "",
          type: getActionType(item.subject),
          isUpcoming,
          currentPrice,
        };
      })
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("Corporate actions API error:", error);
    return NextResponse.json({ error: "Failed to fetch corporate actions" }, { status: 500 });
  }
}

function getActionType(subject: string): string {
  const s = subject?.toLowerCase() || "";
  if (s.includes("dividend")) return "Dividend";
  if (s.includes("split") || s.includes("face value")) return "Split";
  if (s.includes("bonus")) return "Bonus";
  if (s.includes("rights")) return "Rights";
  return "Other";
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  try {
    const [day, month, year] = dateStr.split("-");
    return new Date(`${month} ${day}, ${year}`);
  } catch {
    return null;
  }
}

function isWithinDays(date: Date | null, days: number): boolean {
  if (!date) return false;
  const now = new Date();
  const future = new Date(now);
  future.setDate(future.getDate() + days);
  return date >= now && date <= future;
}
