import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Lazy-load service to avoid Prisma initialization at build time
  const { getPaginatedPosts, getTotalPosts } = await import("@/lib/services/postService");

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const postsPerPage = 5;

  // Fetch paginated posts
  const posts = await getPaginatedPosts(page, postsPerPage);

  const totalPosts = await getTotalPosts();
  const totalPages = Math.ceil(totalPosts / postsPerPage);

  return NextResponse.json({ posts, totalPages });
}
