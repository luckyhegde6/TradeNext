// app/api/ingest/from-zip/route.ts
import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export const runtime = "nodejs";

export async function POST(req: Request) {
    const body = await req.json();
    const zipPath = body?.zipPath;
    if (!zipPath) return NextResponse.json({ error: "zipPath required" }, { status: 400 });

    // simple spawn to run the script detached (so request doesn't time out)
    const node = process.execPath;
    const script = path.resolve(process.cwd(), "scripts/ingest_nse_zip.ts");

    // spawn ts-node, but better to spawn compiled JS in production
    const child = spawn(node, ["-r", "ts-node/register", script, zipPath], {
        detached: true,
        stdio: "ignore",
    });
    child.unref();

    return NextResponse.json({ status: "started" });
}
