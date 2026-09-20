"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/authz";
import { createLocation } from "@/lib/locations";

export async function createLocationAction(formData: FormData): Promise<void> {
  // Authorization first, before any validation or database work. Server
  // Actions are publicly callable HTTP endpoints regardless of what the UI
  // renders, so this must not be skippable by calling the action directly.
  await requireRole("ADMIN");

  const name = String(formData.get("name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "");
  const address = String(formData.get("address") ?? "").trim();

  try {
    if (!name) throw new Error("Name is required.");
    await createLocation({ name, timezone, address: address || undefined });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create location.";
    redirect(`/admin/locations?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/admin/locations");
  const successMessage = `${name} was added.`;
  redirect(`/admin/locations?success=${encodeURIComponent(successMessage)}`);
}
