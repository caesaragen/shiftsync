"use client";

import { useEffect, useRef } from "react";
import { useToast } from "./ToastProvider";

/**
 * Bridges Server Action redirects (which carry feedback as `?error=`/
 * `?success=` query params, since the actions themselves have no client-side
 * presence) into toasts. Fires once per distinct param value.
 *
 * Deliberately does NOT strip the param from the URL afterward: several
 * pages also render their own inline `role="alert"` banner from the same
 * `error` prop (kept as the accessible, persistent copy of the message), and
 * that banner is server-rendered from the current URL's search params. A
 * client-side URL rewrite here would re-render those pages without `error`
 * and silently remove the inline banner a moment after it appeared -- worse,
 * it broke `e2e/login.spec.ts`'s assertion that `?error=invalid` stays in
 * the URL after a failed sign-in. The dedup ref below is what actually
 * matters: it stops the same value from re-toasting on unrelated re-renders
 * within the same page instance.
 */
export function FlashToast({
  error,
  success,
}: {
  readonly error?: string;
  readonly success?: string;
}) {
  const { toast } = useToast();
  const lastShown = useRef<string | null>(null);

  useEffect(() => {
    const value = error ?? success;
    if (!value || value === lastShown.current) return;
    lastShown.current = value;
    toast(value, error ? "error" : "success");
  }, [error, success, toast]);

  return null;
}
