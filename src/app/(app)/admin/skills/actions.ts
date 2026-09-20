"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/authz";
import { createSkill } from "@/lib/skills";

export async function createSkillAction(formData: FormData): Promise<void> {
  // Authorization first, before any validation or database work. Server
  // Actions are publicly callable HTTP endpoints regardless of what the UI
  // renders, so this must not be skippable by calling the action directly.
  await requireRole("ADMIN");

  const name = String(formData.get("name") ?? "");

  try {
    await createSkill(name);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create skill.";
    redirect(`/admin/skills?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/admin/skills");
  const successMessage = `${name} was added.`;
  redirect(`/admin/skills?success=${encodeURIComponent(successMessage)}`);
}
