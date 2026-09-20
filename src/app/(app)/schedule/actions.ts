"use server";

import { requireRole } from "@/lib/authz";
import { createShift, publishWeek, unpublishWeek } from "@/lib/shifts";
import { parseDateOnly } from "@/lib/time/zones";

export async function createShiftAction(formData: FormData): Promise<{ shiftId: string }> {
  // Authorization first, before any validation or database work. Server
  // Actions are publicly callable HTTP endpoints regardless of what the UI
  // renders, so this must not be skippable by calling the action directly.
  const user = await requireRole("MANAGER", "ADMIN");

  // formData.get() returns FormDataEntryValue (string | File) or null; coalescing with ""
  // ensures a string before calling String() to be extra safe
  const locationId = String((formData.get("locationId") as string | null) ?? "").trim();
  const startAtStr = String((formData.get("startAt") as string | null) ?? "").trim();
  const endAtStr = String((formData.get("endAt") as string | null) ?? "").trim();
  const requiredSkillId = String((formData.get("requiredSkillId") as string | null) ?? "").trim();
  const headcountStr = String((formData.get("headcount") as string | null) ?? "").trim();
  const notes = String((formData.get("notes") as string | null) ?? "").trim();

  if (!locationId) throw new Error("Location is required.");
  if (!startAtStr) throw new Error("Start time is required.");
  if (!endAtStr) throw new Error("End time is required.");
  if (!requiredSkillId) throw new Error("Skill is required.");
  if (!headcountStr) throw new Error("Headcount is required.");

  const startAt = new Date(startAtStr);
  const endAt = new Date(endAtStr);
  const headcount = Number.parseInt(headcountStr, 10);

  if (Number.isNaN(startAt.getTime())) throw new Error("Invalid start time.");
  if (Number.isNaN(endAt.getTime())) throw new Error("Invalid end time.");
  if (Number.isNaN(headcount)) throw new Error("Invalid headcount.");

  const shift = await createShift(user, {
    locationId,
    startAt,
    endAt,
    requiredSkillId,
    headcount,
    notes: notes || undefined,
  });

  return { shiftId: shift.id };
}

export async function publishWeekAction(
  locationId: string,
  weekOf: string,
): Promise<{ count: number }> {
  // Authorization first
  const user = await requireRole("MANAGER", "ADMIN");

  const weekOfDate = parseDateOnly(weekOf);
  const result = await publishWeek(user, locationId, weekOfDate);
  return result;
}

export async function unpublishWeekAction(
  locationId: string,
  weekOf: string,
): Promise<{ count: number }> {
  // Authorization first
  const user = await requireRole("MANAGER", "ADMIN");

  const weekOfDate = parseDateOnly(weekOf);

  try {
    const result = await unpublishWeek(user, locationId, weekOfDate);
    return result;
  } catch (error) {
    // Surface the specific cutoff message if that's the error
    if (error instanceof Error && error.message.includes("48-hour edit cutoff")) {
      throw new Error(error.message);
    }
    throw error;
  }
}
