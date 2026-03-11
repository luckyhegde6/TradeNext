import prisma from "../lib/prisma";

async function checkData() {
  try {
    const blockCount = await prisma.blockDeal.count();
    const bulkCount = await prisma.bulkDeal.count();
    const shortCount = await prisma.shortSelling.count();
    
    console.log("Database counts:");
    console.log("  Block Deals:", blockCount);
    console.log("  Bulk Deals:", bulkCount);
    console.log("  Short Selling:", shortCount);
    
    // Show sample block deal
    if (blockCount > 0) {
      const sample = await prisma.blockDeal.findFirst();
      console.log("\nSample Block Deal:", JSON.stringify(sample, null, 2));
    }
  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkData();
