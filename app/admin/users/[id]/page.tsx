export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { hash } from "bcryptjs";

export default async function AdminEditUserPage({ params }: { params: Promise<{ id: string }> }) {
    // Await params before accessing its properties
    const { id } = await params;
    const userId = parseInt(id);
    const { default: prisma } = await import("@/lib/prisma");

    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!user) {
        notFound();
    }

    async function updateUser(formData: FormData) {
        "use server";
        const { default: prisma } = await import("@/lib/prisma");
        const name = formData.get("name") as string;
        const email = formData.get("email") as string;
        const role = formData.get("role") as string;

        await prisma.user.update({
            where: { id: userId },
            data: { name, email, role },
        });

        revalidatePath("/admin/users");
        redirect("/admin/users");
    }

    async function resetPassword(formData: FormData) {
        "use server";
        const { default: prisma } = await import("@/lib/prisma");
        const newPassword = formData.get("newPassword") as string;

        if (!newPassword) return;

        const hashedPassword = await hash(newPassword, 10);

        await prisma.user.update({
            where: { id: userId },
            data: { password: hashedPassword },
        });

        revalidatePath("/admin/users");
        redirect("/admin/users");
    }

    return (
        <div className="min-h-screen bg-gray-50 p-8 flex justify-center">
            <div className="max-w-2xl w-full bg-white rounded-lg shadow p-8 space-y-8">
                <h1 className="text-2xl font-bold text-gray-900">Edit User: {user.name}</h1>

                {/* Details Form */}
                <form action={updateUser} className="space-y-4 border-b pb-8">
                    <h2 className="text-xl font-semibold">Details</h2>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Name</label>
                        <input type="text" name="name" defaultValue={user.name || ""} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 border p-2" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Email</label>
                        <input type="email" name="email" defaultValue={user.email} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 border p-2" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Role</label>
                        <select name="role" defaultValue={user.role} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 border p-2">
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                        </select>
                    </div>
                    <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Update Details</button>
                </form>

                {/* Password Reset Form */}
                <form action={resetPassword} className="space-y-4">
                    <h2 className="text-xl font-semibold text-red-600">Reset Password</h2>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">New Password</label>
                        <input type="text" name="newPassword" placeholder="Enter new password" required className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 border p-2" />
                    </div>
                    <button type="submit" className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700">Reset Password</button>
                </form>
            </div>
        </div>
    );
}
