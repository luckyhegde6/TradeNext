import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import csv from "csv-parser";
import { Readable } from "stream";
import { auth } from "@/lib/auth";
import logger from "@/lib/logger";

export const maxDuration = 60; // Allow longer timeout

export async function POST() {
    try {
        const session = await auth();
        const user = session?.user as { role?: string };
        const isAdmin = user?.role === "admin";

        if (!session || !isAdmin) {
            logger.warn({ msg: 'Unauthorized access to admin announcements ingest', user: session?.user?.email });
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        logger.info({ msg: 'Admin announcements ingest started', user: session.user.email });

        // Official NSE Corporate Announcements CSV URL
        const CSV_URL = "https://www.nseindia.com/api/corporate-announcements?index=equities&reqXbrl=false&csv=true";

        // Note: NSE often blocks direct server requests without valid headers. 
        // We might need to mimic a browser or use a library that handles cookies/headers if this fails.
        // For now, attempting a standard fetch with User-Agent.
        const response = await fetch(CSV_URL, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                "Accept": "text/csv,application/json",
            }
        });

        if (!response.ok) {
            return NextResponse.json({ error: `NSE Fetch Failed: ${response.status}` }, { status: 502 });
        }

        const csvText = await response.text();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const results: any[] = [];

        // Parse CSV
        const stream = Readable.from(csvText);
        const parser = stream.pipe(csv());

        for await (const row of parser) {
            results.push(row);
        }

        // Upsert logic
        for (const row of results) {
            // NSE CSV headers strictly case-sensitive? usually yes.
            // Expected headers based on user description/standard NSE:
            // "SYMBOL", "COMPANY_NAME", "SUBJECT", "DETAILS", "BROADCAST_DATE_TIME", "ATTACHMENT"

            const symbol = row["SYMBOL"] || row["Symbol"];
            const companyName = row["COMPANY_NAME"] || row["Company Name"];
            const subject = row["SUBJECT"] || row["Subject"];
            const details = row["DETAILS"] || row["Details"];
            const broadcastRaw = row["BROADCAST_DATE_TIME"] || row["Broadcast Date/Time"];
            const attachment = row["ATTACHMENT"] || row["Attachment"];

            if (!symbol || !broadcastRaw) continue;

            // Parse Date: "06-Dec-2025 01:11:31" -> ISO
            // Assuming Format DD-Mon-YYYY HH:mm:ss
            const broadcastDateTime = new Date(broadcastRaw);

            if (isNaN(broadcastDateTime.getTime())) continue;

            await prisma.corporateAnnouncement.create({
                data: {
                    symbol,
                    companyName: companyName || "",
                    subject: subject || "",
                    details: details || "",
                    broadcastDateTime,
                    attachment: attachment || "",
                },
            });
        }

        logger.info({ msg: 'Admin announcements ingest completed', count: results.length });
        return NextResponse.json({ success: true, count: results.length });
    } catch (e: unknown) {
        const errorMessage = (e instanceof Error ? e.message : "Ingestion failed");
        logger.error({ msg: 'Admin announcements ingest failed', error: errorMessage });
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
