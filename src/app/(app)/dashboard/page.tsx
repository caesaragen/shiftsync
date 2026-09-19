import { requireUser } from "@/lib/authz";

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <main className="mx-auto mt-24 max-w-sm text-center">
      <p>Signed in as {user.name}</p>
      <p className="text-sm text-gray-500">{user.role}</p>
    </main>
  );
}
