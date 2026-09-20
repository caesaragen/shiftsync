"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/authz";
import {
  addRecurringWindow,
  addExceptionWindow,
  deleteAvailabilityRow,
} from "@/lib/staff-availability";
import { parseDateOnly } from "@/lib/time/zones";

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : "Could not complete that action.";
  redirect(`/availability?error=${encodeURIComponent(message)}`);
}

function succeed(message: string): never {
  redirect(`/availability?success=${encodeURIComponent(message)}`);
}

/**
 * `<input type="time">` submits "HH:MM" (24-hour, no timezone). Availability
 * windows are wall-clock local time in the staff member's own home
 * timezone -- there's no conversion to do here, unlike shift times, which
 * are converted through `parseLocalDateTime` because they belong to a
 * *location's* timezone that differs from whoever's filling out the form.
 */
function parseTimeToMinutes(value: string, fieldLabel: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`${fieldLabel} is required.`);
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  return hours * 60 + minutes;
}

export async function addRecurringWindowAction(formData: FormData): Promise<void> {
  // Authorization first, before any validation or database work. Server
  // Actions are publicly callable HTTP endpoints regardless of what the UI
  // renders, so this must not be skippable by calling the action directly.
  const user = await requireRole("STAFF");

  const dayOfWeekStr = String(formData.get("dayOfWeek") ?? "");
  const startStr = String(formData.get("startTime") ?? "");
  const endStr = String(formData.get("endTime") ?? "");

  try {
    const dayOfWeek = Number.parseInt(dayOfWeekStr, 10);
    if (Number.isNaN(dayOfWeek)) throw new Error("Day of week is required.");
    const startMinutes = parseTimeToMinutes(startStr, "Start time");
    const endMinutes = parseTimeToMinutes(endStr, "End time");

    await addRecurringWindow(user.id, { dayOfWeek, startMinutes, endMinutes });
  } catch (error) {
    fail(error);
  }

  revalidatePath("/availability");
  succeed("Weekly availability added.");
}

export async function addExceptionWindowAction(formData: FormData): Promise<void> {
  const user = await requireRole("STAFF");

  const dateStr = String(formData.get("date") ?? "");
  // A single checkbox's presence in FormData means "checked"; absence means
  // unchecked -- there is no unchecked value to read.
  const isAvailable = formData.get("isAvailable") === "on";
  const startStr = String(formData.get("startTime") ?? "");
  const endStr = String(formData.get("endTime") ?? "");

  try {
    if (!dateStr) throw new Error("Date is required.");
    const date = parseDateOnly(dateStr);

    if (isAvailable) {
      const startMinutes = parseTimeToMinutes(startStr, "Start time");
      const endMinutes = parseTimeToMinutes(endStr, "End time");
      await addExceptionWindow(user.id, { date, isAvailable: true, startMinutes, endMinutes });
    } else {
      await addExceptionWindow(user.id, { date, isAvailable: false });
    }
  } catch (error) {
    fail(error);
  }

  revalidatePath("/availability");
  succeed("Exception added.");
}

export async function deleteAvailabilityAction(formData: FormData): Promise<void> {
  const user = await requireRole("STAFF");
  const id = String(formData.get("id") ?? "");

  try {
    if (!id) throw new Error("Missing row id.");
    await deleteAvailabilityRow(user.id, id);
  } catch (error) {
    fail(error);
  }

  revalidatePath("/availability");
  succeed("Removed.");
}
