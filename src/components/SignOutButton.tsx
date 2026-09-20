"use client";

import { useTransition } from "react";

export function SignOutButton({ onSignOut }: { readonly onSignOut: () => void | Promise<void> }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      aria-busy={isPending}
      onClick={() => startTransition(async () => onSignOut())}
      className="text-sm text-gray-600 underline underline-offset-4 hover:text-gray-900 disabled:opacity-60"
    >
      {isPending ? "Signing out…" : "Sign out"}
    </button>
  );
}
