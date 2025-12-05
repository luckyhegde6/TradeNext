export const dynamic = "force-dynamic"; // This disables SSG and ISR

import Form from "next/form";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function NewPost() {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth/signin?callbackUrl=/posts/new");
  }

  async function createPost(formData: FormData) {
    "use server";

    // Lazy-load Prisma in server action
    const { default: prisma } = await import("@/lib/prisma");
    const { auth } = await import("@/lib/auth"); // Re-import not needed but good for clarity in action context if separate
    const session = await auth(); // Re-fetch session in action for security

    if (!session?.user?.email) {
      throw new Error("You must be signed in to create a post.");
    }

    const authorEmail = session.user.email;
    const title = formData.get("title") as string;
    const content = formData.get("content") as string;

    await prisma.post.create({
      data: {
        title,
        content,
        author: {
          connect: {
            email: authorEmail,
          },
        },
      },
    });

    revalidatePath("/posts");
    redirect("/posts");
  }

  return (
    <div className="max-w-2xl mx-auto p-4 py-8">
      <h1 className="text-3xl font-extrabold text-gray-900 mb-8">Create New Post</h1>
      <Form action={createPost} className="space-y-6 bg-white p-8 rounded-xl shadow-sm border border-gray-100">
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="title"
            name="title"
            required
            placeholder="Give your post a catchy title..."
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder-gray-400"
          />
        </div>

        <div>
          <label htmlFor="content" className="block text-sm font-medium text-gray-700 mb-2">
            Content
          </label>
          <textarea
            id="content"
            name="content"
            placeholder="Share your thoughts..."
            rows={8}
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder-gray-400 resize-y"
          />
        </div>

        <div className="pt-4">
          <button
            type="submit"
            className="w-full bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all shadow-md hover:shadow-lg"
          >
            Publish Post
          </button>
        </div>
      </Form>
    </div>
  );
}
