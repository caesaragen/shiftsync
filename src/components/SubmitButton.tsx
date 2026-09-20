"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/**
 * A submit button that shows its own pending state via `useFormStatus`,
 * which reads the enclosing <form>'s submission status. Only this button
 * needs to be a Client Component -- the surrounding form and page stay
 * Server Components, so every Server Action form gets a loading state for
 * free without being converted to client-side submission.
 */
export function SubmitButton({
  children,
  pendingText,
  className,
}: {
  readonly children: ReactNode;
  readonly pendingText?: string;
  readonly className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={className}>
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          {pendingText ?? "Working…"}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
