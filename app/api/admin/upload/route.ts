// app/api/admin/upload/route.ts
import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import { auth } from "@/lib/auth";
import logger from "@/lib/logger";
import { createAuditLog } from "@/lib/audit";
import { spawnAsyncTask } from "@/lib/services/worker/task-orchestrator";

export const runtime = "nodejs";

export async function POST(req: Request) {
    try {
        const session = await auth();
        const user = session?.user as { role?: string; id?: string };
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

        await createAuditLog({
            action: 'ADMIN_UPLOAD',
            resource: 'AdminUpload',
            metadata: { fileName: uniqueName }
        });

        // Spawn an async worker task for CSV processing if it's a CSV file
        let workerTask = null;
        if (file.name.endsWith(".csv")) {
            workerTask = await spawnAsyncTask({
                name: `CSV Ingest: ${file.name}`,
                taskType: "csv_processing",
                priority: 6,
                payload: { filePath, fileName: uniqueName, originalName: file.name },
                createdBy: user.id ? parseInt(user.id) : undefined,
                triggeredBy: "upload",
            });
            logger.info({ msg: 'Async CSV processing task created', taskId: workerTask.id, fileName: uniqueName });
        }

        logger.info({ msg: 'Admin file upload completed', fileName: uniqueName, filePath });
        return NextResponse.json({
            success: true,
            filePath,
            fileName: uniqueName,
            workerTaskId: workerTask?.id ?? null,
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

