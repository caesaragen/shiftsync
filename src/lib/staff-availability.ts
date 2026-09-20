import type { Availability } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const MIN_MINUTES = 0;
const MAX_MINUTES = 24 * 60; // Self-service windows are same-day only; overnight windows aren't exposed here.

function assertValidRange(startMinutes: number, endMinutes: number): void {
  if (!Number.isInteger(startMinutes) || !Number.isInteger(endMinutes)) {
    throw new Error("Start and end time are required.");
  }
  if (startMinutes < MIN_MINUTES || endMinutes > MAX_MINUTES) {
    throw new Error("Times must be within a single day.");
  }
  if (startMinutes >= endMinutes) {
    throw new Error("End time must be after start time.");
  }
}

/** Every availability row a staff member owns -- recurring rows first (by day, then start time), then exceptions (by date). */
export async function listMyAvailability(staffId: string): Promise<Availability[]> {
  return prisma.availability.findMany({
    where: { staffId },
    orderBy: [{ kind: "asc" }, { dayOfWeek: "asc" }, { date: "asc" }, { startMinutes: "asc" }],
  });
}

/**
 * Adds a recurring weekly availability window. Always `isAvailable: true`
 * -- a RECURRING row with `isAvailable: false` would never contribute an
 * available interval (see availability.ts's `effectiveRowsForDate`), so
 * it's indistinguishable from having no row at all. The self-service UI
 * doesn't expose a control that can't do anything.
 */
export async function addRecurringWindow(
  staffId: string,
  input: { dayOfWeek: number; startMinutes: number; endMinutes: number },
): Promise<Availability> {
  if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 1 || input.dayOfWeek > 7) {
    throw new Error("Day of week is required.");
  }
  assertValidRange(input.startMinutes, input.endMinutes);

  return prisma.availability.create({
    data: {
      staffId,
      kind: "RECURRING",
      dayOfWeek: input.dayOfWeek,
      startMinutes: input.startMinutes,
      endMinutes: input.endMinutes,
      isAvailable: true,
    },
  });
}

/**
 * Adds a one-off exception for a specific calendar date. Per
 * `effectiveRowsForDate`'s documented semantics, ANY exception row for a
 * date replaces the recurring pattern for that date entirely -- so
 * `isAvailable: false` ("day off") ignores any supplied times (the row is
 * filtered out of every interval computation regardless of its own
 * start/end, so a full-day placeholder is stored rather than trusting
 * caller-supplied values that would never be read), while
 * `isAvailable: true` ("extra or different hours this day") requires a
 * real range.
 */
export async function addExceptionWindow(
  staffId: string,
  input: { date: Date; isAvailable: boolean; startMinutes?: number; endMinutes?: number },
): Promise<Availability> {
  if (!input.isAvailable) {
    return prisma.availability.create({
      data: {
        staffId,
        kind: "EXCEPTION",
        date: input.date,
        startMinutes: MIN_MINUTES,
        endMinutes: MAX_MINUTES,
        isAvailable: false,
      },
    });
  }

  const startMinutes = input.startMinutes ?? NaN;
  const endMinutes = input.endMinutes ?? NaN;
  assertValidRange(startMinutes, endMinutes);

  return prisma.availability.create({
    data: {
      staffId,
      kind: "EXCEPTION",
      date: input.date,
      startMinutes,
      endMinutes,
      isAvailable: true,
    },
  });
}

/** Deletes an availability row, but only if it belongs to `staffId` -- never trusts a bare id from form data. */
export async function deleteAvailabilityRow(staffId: string, id: string): Promise<void> {
  await prisma.availability.deleteMany({ where: { id, staffId } });
}
