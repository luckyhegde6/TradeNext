// app/api/admin/upload/route.ts
import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { existsSync } from "fs";

export const runtime = "nodejs";

export async function POST(req: Request) {
    try {
        const formData = await req.formData();
        const file = formData.get("file") as File;

        if (!file) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

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

        return NextResponse.json({
            success: true,
            filePath,
            fileName: uniqueName
        });
    } catch (e: unknown) {
        console.error(e);
        return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }
}
