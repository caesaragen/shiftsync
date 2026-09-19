"use client";

export function SignOutButton({ onSignOut }: { onSignOut: () => void }) {
  return (
    <button
      type="button"
      onClick={onSignOut}
      className="text-sm text-gray-600 underline underline-offset-4 hover:text-gray-900"
    >
      Sign out
    </button>
  );
}
