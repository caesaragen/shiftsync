import Link from "next/link";
import { requireUser } from "@/lib/authz";
import { SignOutButton } from "@/components/SignOutButton";
import { signOutAction } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <>
      <header className="border-b">
        <nav className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex flex-wrap items-center gap-6 text-sm">
            <Link href="/dashboard" className="font-semibold tracking-tight">
              ShiftSync
            </Link>
            <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">
              Dashboard
            </Link>
            {/* Hiding these links is presentation only, never access control —
                each admin page and Server Action still calls requireRole("ADMIN")
                itself regardless of what the nav shows. */}
            {user.role === "ADMIN" && (
              <>
                <Link href="/admin/locations" className="text-gray-600 hover:text-gray-900">
                  Locations
                </Link>
                <Link href="/admin/skills" className="text-gray-600 hover:text-gray-900">
                  Skills
                </Link>
                <Link href="/admin/staff" className="text-gray-600 hover:text-gray-900">
                  Staff
                </Link>
              </>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-600">
              {user.name} · {user.role}
            </span>
            <SignOutButton onSignOut={signOutAction} />
          </div>
        </nav>
      </header>
      {children}
    </>
  );
}
