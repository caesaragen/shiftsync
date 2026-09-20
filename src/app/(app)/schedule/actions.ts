"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/authz";
import { createShift, publishWeek, unpublishWeek } from "@/lib/shifts";
import { parseDateOnly, parseLocalDateTime } from "@/lib/time/zones";
import { prisma } from "@/lib/prisma";

export async function createShiftAction(formData: FormData): Promise<void> {
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

  try {
    if (!locationId) throw new Error("Location is required.");
    if (!startAtStr) throw new Error("Start time is required.");
    if (!endAtStr) throw new Error("End time is required.");
    if (!requiredSkillId) throw new Error("Skill is required.");
    if (!headcountStr) throw new Error("Headcount is required.");

    // The <input type="datetime-local"> values above carry no timezone
    // designator, so they must be parsed as wall-clock time IN THE SHIFT'S
    // OWN LOCATION -- never with the bare `new Date(string)` constructor,
    // which would anchor them to whatever timezone this server process
    // happens to be running in instead. See parseLocalDateTime's doc
    // comment for the specific bug this guards against.
    const location = await prisma.location.findUnique({
      where: { id: locationId },
      select: { timezone: true },
    });
    if (!location) throw new Error("Location not found.");

    const startAt = parseLocalDateTime(startAtStr, location.timezone);
    const endAt = parseLocalDateTime(endAtStr, location.timezone);
    const headcount = Number.parseInt(headcountStr, 10);

    if (Number.isNaN(startAt.getTime())) throw new Error("Invalid start time.");
    if (Number.isNaN(endAt.getTime())) throw new Error("Invalid end time.");
    if (Number.isNaN(headcount)) throw new Error("Invalid headcount.");

    await createShift(user, {
      locationId,
      startAt,
      endAt,
      requiredSkillId,
      headcount,
      notes: notes || undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create shift.";
    redirect(
      `/schedule?locationId=${encodeURIComponent(locationId || "")}&shiftError=${encodeURIComponent(message)}`,
    );
  }

  revalidatePath("/schedule");
  redirect(`/schedule?locationId=${encodeURIComponent(locationId)}`);
}

export async function publishWeekAction(locationId: string, weekOf: string): Promise<void> {
  // Authorization first
  const user = await requireRole("MANAGER", "ADMIN");

  const weekOfDate = parseDateOnly(weekOf);
  await publishWeek(user, locationId, weekOfDate);

  revalidatePath("/schedule");
}

export async function unpublishWeekAction(locationId: string, weekOf: string): Promise<void> {
  // Authorization first
  const user = await requireRole("MANAGER", "ADMIN");

  const weekOfDate = parseDateOnly(weekOf);

  try {
    await unpublishWeek(user, locationId, weekOfDate);
  } catch (error) {
    // Surface the specific cutoff message if that's the error
    if (error instanceof Error && error.message.includes("48-hour edit cutoff")) {
      throw new Error(error.message);
    }
    throw error;
  }

  revalidatePath("/schedule");
}
