import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <main className="mx-auto mt-24 max-w-sm text-center">
      <p>Signed in as {session.user.name}</p>
      <p className="text-sm text-gray-500">{session.user.role}</p>
    </main>
  );
}
