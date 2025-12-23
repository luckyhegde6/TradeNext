// app/api/admin/upload/route.ts
import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import { auth } from "@/lib/auth";
import logger from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(req: Request) {
    try {
        const session = await auth();
        const user = session?.user as { role?: string };
        const isAdmin = user?.role === "admin";

        if (!session || !isAdmin) {
            logger.warn({ msg: 'Unauthorized access to admin upload', user: session?.user?.email });
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const formData = await req.formData();
        const file = formData.get("file") as File;

        if (!file) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        logger.info({ msg: 'Admin file upload started', user: session.user.email, fileName: file.name });

        const buffer = Buffer.from(await file.arrayBuffer());
        // Create dailyUploads/zip directory if it doesn't exist
        // Using process.cwd() to get the root of the project
        const uploadDir = path.resolve(process.cwd(), "dailyUploads/zip");

        if (!existsSync(uploadDir)) {
            await mkdir(uploadDir, { recursive: true });
        }

        // Sanitize filename and append unique suffix to avoid collisions
        const safeName = file.name.replace(/[^a-z0-9.]/gi, "_").toLowerCase();
        const uniqueName = `${Date.now()}-${safeName}`;
        const filePath = path.join(uploadDir, uniqueName);

        await writeFile(filePath, buffer);

        logger.info({ msg: 'Admin file upload completed', fileName: uniqueName, filePath });
        return NextResponse.json({
            success: true,
            filePath,
            fileName: uniqueName,
            meta: {
                fetchedAt: new Date().toISOString(),
                stale: false,
              },
        });
    } catch (e: unknown) {
        const errorMessage = (e instanceof Error ? e.message : "Upload failed");
        logger.error({ msg: 'Admin file upload failed', error: errorMessage });
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
