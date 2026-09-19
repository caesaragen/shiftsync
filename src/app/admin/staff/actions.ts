"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/authz";
import { assignSkill, removeSkill, certifyStaff, decertifyStaff } from "@/lib/staff-assignments";

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : "Could not complete that action.";
  redirect(`/admin/staff?error=${encodeURIComponent(message)}`);
}

export async function assignSkillAction(formData: FormData): Promise<void> {
  // Authorization first, before any validation or database work. Server
  // Actions are publicly callable HTTP endpoints regardless of what the UI
  // renders, so this must not be skippable by calling the action directly.
  await requireRole("ADMIN");

  const staffId = String(formData.get("staffId") ?? "");
  const skillId = String(formData.get("skillId") ?? "");

  try {
    if (!staffId || !skillId) throw new Error("Staff member and skill are required.");
    await assignSkill(staffId, skillId);
  } catch (error) {
    fail(error);
  }

  revalidatePath("/admin/staff");
  redirect("/admin/staff");
}

export async function removeSkillAction(formData: FormData): Promise<void> {
  await requireRole("ADMIN");

  const staffId = String(formData.get("staffId") ?? "");
  const skillId = String(formData.get("skillId") ?? "");

  try {
    if (!staffId || !skillId) throw new Error("Staff member and skill are required.");
    await removeSkill(staffId, skillId);
  } catch (error) {
    fail(error);
  }

  revalidatePath("/admin/staff");
  redirect("/admin/staff");
}

export async function certifyStaffAction(formData: FormData): Promise<void> {
  await requireRole("ADMIN");

  const staffId = String(formData.get("staffId") ?? "");
  const locationId = String(formData.get("locationId") ?? "");

  try {
    if (!staffId || !locationId) throw new Error("Staff member and location are required.");
    await certifyStaff(staffId, locationId);
  } catch (error) {
    fail(error);
  }

  revalidatePath("/admin/staff");
  redirect("/admin/staff");
}

export async function decertifyStaffAction(formData: FormData): Promise<void> {
  await requireRole("ADMIN");

  const staffId = String(formData.get("staffId") ?? "");
  const locationId = String(formData.get("locationId") ?? "");

  try {
    if (!staffId || !locationId) throw new Error("Staff member and location are required.");
    await decertifyStaff(staffId, locationId);
  } catch (error) {
    fail(error);
  }

  revalidatePath("/admin/staff");
  redirect("/admin/staff");
}
