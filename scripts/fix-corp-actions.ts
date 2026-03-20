// scripts/fix-corp-actions.ts
// Fix corporate actions with incorrect actionType

import prisma from "@/lib/prisma";

function parsePurpose(purpose: string): { actionType: string; dividendAmount?: number } {
  const p = (purpose || "").toLowerCase();
  let actionType = "OTHER";
  let dividendAmount: number | undefined = undefined;

  if (p.includes("dividend")) {
    actionType = "DIVIDEND";
    const match = purpose.match(/Rs\.?\s*([\d,.]+)/i);
    if (match) {
      dividendAmount = parseFloat(match[1].replace(/,/g, ""));
    }
  } else if (p.includes("bonus")) {
    actionType = "BONUS";
  } else if (p.includes("split") || p.includes("sub-division")) {
    actionType = "SPLIT";
  } else if (p.includes("rights")) {
    actionType = "RIGHTS";
  } else if (p.includes("buyback")) {
    actionType = "BUYBACK";
  } else if (p.includes("interest")) {
    actionType = "INTEREST";
  } else if (p.includes("demerger")) {
    actionType = "DEMERGER";
  }

  return { actionType, dividendAmount };
}

async function fixCorporateActions() {
  console.log("Starting corporate actions fix...");

  // Find all records with actionType = "OTHER"
  const otherRecords = await prisma.corporateAction.findMany({
    where: { actionType: "OTHER" },
    select: {
      id: true,
      symbol: true,
      subject: true,
      exDate: true,
    },
  });

  console.log(`Found ${otherRecords.length} records with actionType = "OTHER"`);

  let updated = 0;
  let deleted = 0;

  for (const record of otherRecords) {
    const { actionType, dividendAmount } = parsePurpose(record.subject || "");

    if (actionType === "OTHER") {
      // Delete records that couldn't be categorized (board meetings, AGMs, etc.)
      await prisma.corporateAction.delete({
        where: { id: record.id },
      });
      deleted++;
      console.log(`DELETED: ${record.symbol} - ${record.subject}`);
    } else {
      // Check if a record with correct actionType already exists
      const existing = await prisma.corporateAction.findFirst({
        where: {
          symbol: record.symbol,
          actionType: actionType,
          exDate: record.exDate,
        },
      });

      if (existing) {
        // Merge data from old record to existing record, then delete old
        await prisma.corporateAction.update({
          where: { id: existing.id },
          data: {
            subject: record.subject,
            dividendPerShare: dividendAmount || existing.dividendPerShare,
          },
        });
        await prisma.corporateAction.delete({
          where: { id: record.id },
        });
        console.log(`MERGED: ${record.symbol} (${record.subject}) -> ${actionType}`);
      } else {
        // Update the record with correct actionType
        await prisma.corporateAction.update({
          where: { id: record.id },
          data: {
            actionType: actionType,
            dividendPerShare: dividendAmount,
          },
        });
        console.log(`UPDATED: ${record.symbol} -> ${actionType} (${record.subject})`);
      }
      updated++;
    }
  }

  console.log(`\nFix complete!`);
  console.log(`  Updated: ${updated} records`);
  console.log(`  Deleted: ${deleted} records`);

  // Show final counts
  const counts = await prisma.corporateAction.groupBy({
    by: ["actionType"],
    _count: { id: true },
  });

  console.log("\nFinal counts:");
  for (const c of counts) {
    console.log(`  ${c.actionType}: ${c._count.id}`);
  }
}

fixCorporateActions()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
