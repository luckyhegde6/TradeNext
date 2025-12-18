import { NextResponse } from "next/server";
import { getRecentPosts } from "@/lib/services/homeService";

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const limit = parseInt(url.searchParams.get("limit") || "3");

        const posts = await getRecentPosts(limit);
        return NextResponse.json({ posts });
    } catch (err: unknown) {
        console.error(err);
        return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
    }
}
