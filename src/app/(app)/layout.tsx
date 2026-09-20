import Link from "next/link";
import { requireUser } from "@/lib/authz";
import { SignOutButton } from "@/components/SignOutButton";
import { signOutAction } from "./actions";
import { NavLinks } from "./_components/NavLinks";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <>
      <header className="border-b border-border-subtle bg-white/80 backdrop-blur-sm supports-backdrop-filter:bg-white/60 sticky top-0 z-10">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex flex-wrap items-center gap-1 text-sm">
            <Link
              href="/dashboard"
              className="mr-4 flex items-center gap-2 font-semibold tracking-tight text-gray-900"
            >
              <span
                aria-hidden
                className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-xs font-bold text-white"
              >
                S
              </span>
              ShiftSync
            </Link>
            <NavLinks isAdmin={user.role === "ADMIN"} />
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-600">
              {user.name} <span className="text-gray-300">·</span>{" "}
              <span className="font-medium text-gray-900">{user.role}</span>
            </span>
            <SignOutButton onSignOut={signOutAction} />
          </div>
        </nav>
      </header>
      {children}
    </>
  );
}
