import { redirect } from "next/navigation";

// Legacy self-signup page — DISABLED (v3.6.0).
// All new users go through the admin-moderated join-request flow at /auth/join.
export default function NewUserPage() {
  redirect("/auth/join");
}