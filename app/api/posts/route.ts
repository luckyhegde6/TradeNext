import { NextResponse } from "next/server";
import logger from "@/lib/logger";

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const startTime = Date.now();

  try {
    // Lazy-load service to avoid Prisma initialization at build time
    const { getPaginatedPosts, getTotalPosts } = await import("@/lib/services/postService");

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const postsPerPage = 5;

    logger.info({ msg: 'Fetching paginated posts', page, postsPerPage });

    // Fetch paginated posts
    const posts = await getPaginatedPosts(page, postsPerPage);
    const totalPosts = await getTotalPosts();
    const totalPages = Math.ceil(totalPosts / postsPerPage);

    const duration = Date.now() - startTime;
    logger.info({ msg: 'Posts fetched successfully', page, count: posts.length, totalPosts, totalPages, duration });

    return NextResponse.json({ posts, totalPages });
  } catch (err: unknown) {
    const duration = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ msg: 'Failed to fetch posts', error: errorMessage, duration });
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
