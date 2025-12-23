import NewUserForm from "./NewUserForm";

export const dynamic = "force-dynamic";

export default function NewUser() {
  return (
    <main className="min-h-screen py-12 px-4 sm:px-6 lg:px-8 bg-background transition-colors duration-200">
      <div className="max-w-7xl mx-auto">
        <NewUserForm />
      </div>
    </main>
  );
}
