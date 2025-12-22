import prisma from "@/lib/prisma";

export async function getRecentPosts(limit: number = 3) {
    try {
        const posts = await prisma.post.findMany({
            take: limit,
            orderBy: { createdAt: "desc" },
            include: {
                author: {
                    select: { name: true },
                },
            },
        });
        return posts;
    } catch {
        return [];
    }
}
