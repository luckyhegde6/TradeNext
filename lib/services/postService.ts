import prisma from "@/lib/prisma";

export async function getPaginatedPosts(page: number, postsPerPage: number) {
    const offset = (page - 1) * postsPerPage;

    const posts = await prisma.post.findMany({
        skip: offset,
        take: postsPerPage,
        orderBy: { createdAt: "desc" },
        include: { author: { select: { name: true } } },
    });

    return posts;
}

export async function getTotalPosts() {
    return await prisma.post.count();
}

export async function createPost(data: { title: string; content: string; authorEmail: string }) {
    return await prisma.post.create({
        data: {
            title: data.title,
            content: data.content,
            author: {
                connect: {
                    email: data.authorEmail,
                },
            },
        },
    });
}