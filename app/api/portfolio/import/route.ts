import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { parseCSV, detectBrokerTemplate, BROKER_TEMPLATES, validateImportData } from "@/lib/import-utils";

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id);
    const formData = await req.formData();
    
    const file = formData.get('file') as File;
    const portfolioId = formData.get('portfolioId') as string;
    const broker = formData.get('broker') as string || 'generic';

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!portfolioId) {
      return NextResponse.json({ error: "Portfolio ID required" }, { status: 400 });
    }

    const portfolio = await prisma.portfolio.findFirst({
      where: { id: portfolioId, userId },
    });

    if (!portfolio) {
      return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    }

    const content = await file.text();
    const lines = content.trim().split('\n');
    const headers = parseCSVLine(lines[0]);
    
    let mapping: Record<string, number>;
    
    if (broker === 'auto') {
      const detectedBroker = detectBrokerTemplate(headers);
      mapping = BROKER_TEMPLATES[detectedBroker as keyof typeof BROKER_TEMPLATES]?.mapping || BROKER_TEMPLATES.generic.mapping;
    } else {
      mapping = BROKER_TEMPLATES[broker as keyof typeof BROKER_TEMPLATES]?.mapping || BROKER_TEMPLATES.generic.mapping;
    }

    const parsedTransactions = parseCSV(content, mapping as any);
    const { valid, invalid } = validateImportData(parsedTransactions, portfolioId);

    const imported: any[] = [];
    const errors: string[] = [];

    for (const txn of valid) {
      try {
        const transaction = await prisma.transaction.create({
          data: {
            portfolioId,
            ticker: txn.ticker,
            side: txn.side,
            quantity: txn.quantity,
            price: txn.price,
            tradeDate: txn.date,
            fees: txn.fees || 0,
          },
        });
        imported.push(transaction);
      } catch (err) {
        errors.push(`Failed to import ${txn.ticker}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    return NextResponse.json({
      success: true,
      imported: imported.length,
      skipped: invalid.length,
      errors,
      invalidRows: invalid.map(i => ({
        date: i.transaction.date,
        ticker: i.transaction.ticker,
        reason: i.reason
      }))
    });
  } catch (error) {
    console.error('Import error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Import failed' },
      { status: 500 }
    );
  }
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}
