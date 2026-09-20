import type { Shift, Location, Skill, ShiftAssignment, User, ShiftStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  assertCanManageLocation,
  canSeeLocation,
  visibleLocationScope,
  type SessionUser,
} from "@/lib/authz";
import { toZoned, weekBounds } from "@/lib/time/zones";

export const EDIT_CUTOFF_HOURS = 48;

export type ShiftWithDetail = Shift & {
  location: Location;
  requiredSkill: Skill;
  assignments: (ShiftAssignment & { staff: User })[];
};

/**
 * Returns true if the shift starts on Friday or Saturday at 17:00 or later
 * in the location's timezone. Uses the location's timezone to determine the
 * day of week and hour, not UTC.
 */
export function isPremiumShift(startAt: Date, locationTimeZone: string): boolean {
  const zoned = toZoned(startAt, locationTimeZone);
  const dayOfWeek = zoned.weekday; // 1=Mon, 2=Tue, ..., 5=Fri, 6=Sat, 7=Sun
  const hour = zoned.hour;

  const isFriday = dayOfWeek === 5;
  const isSaturday = dayOfWeek === 6;
  const isAtOrAfter17 = hour >= 17;

  return (isFriday || isSaturday) && isAtOrAfter17;
}

/**
 * Returns true if the shift is published and starts within 48 hours from now.
 * DRAFT shifts are always editable (returns false).
 */
export function isWithinEditCutoff(
  shift: { status: ShiftStatus; startAt: Date },
  now: Date,
): boolean {
  if (shift.status !== "PUBLISHED") {
    return false;
  }

  const timeUntilStart = shift.startAt.getTime() - now.getTime();
  const hoursUntilStart = timeUntilStart / (1000 * 60 * 60);

  // True if less than or equal to 48 hours and not in the past
  return hoursUntilStart <= EDIT_CUTOFF_HOURS && hoursUntilStart > 0;
}

/**
 * Lists all shifts for a given location during the Monday-start week containing
 * the given date (in the location's timezone). Enforces authorization via
 * visibleLocationScope/canSeeLocation to allow STAFF reads at certified locations.
 */
export async function listWeekShifts(
  user: SessionUser,
  locationId: string,
  weekOf: Date,
): Promise<ShiftWithDetail[]> {
  // Check read authorization: STAFF can read locations they're certified for,
  // MANAGER/ADMIN per their assigned locations
  const scope = await visibleLocationScope(user);
  if (!canSeeLocation(scope, locationId)) {
    throw new Error("You do not have access to this resource.");
  }

  // Fetch location timezone for correct week-boundary calculation
  const location = await prisma.location.findUniqueOrThrow({
    where: { id: locationId },
    select: { timezone: true },
  });

  const { start, end } = weekBounds(weekOf, location.timezone);

  return prisma.shift.findMany({
    where: {
      locationId,
      startAt: {
        gte: start,
        lt: end,
      },
    },
    include: {
      location: true,
      requiredSkill: true,
      assignments: {
        include: {
          staff: true,
        },
      },
    },
  });
}

/**
 * Gets a shift by ID with full details (location, skill, assignments).
 * Enforces authorization via visibleLocationScope/canSeeLocation to allow STAFF
 * reads at certified locations.
 */
export async function getShift(user: SessionUser, shiftId: string): Promise<ShiftWithDetail> {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: {
      location: true,
      requiredSkill: true,
      assignments: {
        include: {
          staff: true,
        },
      },
    },
  });

  if (!shift) {
    throw new Error(`Shift ${shiftId} not found.`);
  }

  // Check read authorization: STAFF can read locations they're certified for
  const scope = await visibleLocationScope(user);
  if (!canSeeLocation(scope, shift.locationId)) {
    throw new Error("You do not have access to this resource.");
  }

  return shift;
}

/**
 * Creates a new shift with validation of all inputs before any database write.
 * Enforces authorization via assertCanManageLocation.
 * Rejects:
 * - endAt <= startAt
 * - headcount < 1
 * - unknown location or skill
 */
export async function createShift(
  user: SessionUser,
  input: {
    locationId: string;
    startAt: Date;
    endAt: Date;
    requiredSkillId: string;
    headcount: number;
    notes?: string;
  },
): Promise<Shift> {
  // Authorize first
  await assertCanManageLocation(user, input.locationId);

  // Validate inputs before any write
  if (input.endAt <= input.startAt) {
    throw new Error("End time must be after start time.");
  }

  if (input.headcount < 1) {
    throw new Error("Headcount must be at least 1.");
  }

  // Check that location exists
  const location = await prisma.location.findUnique({
    where: { id: input.locationId },
  });
  if (!location) {
    throw new Error(`Location ${input.locationId} does not exist.`);
  }

  // Check that skill exists
  const skill = await prisma.skill.findUnique({
    where: { id: input.requiredSkillId },
  });
  if (!skill) {
    throw new Error(`Skill ${input.requiredSkillId} does not exist.`);
  }

  // All validation passed, now create the shift
  return prisma.shift.create({
    data: {
      locationId: input.locationId,
      startAt: input.startAt,
      endAt: input.endAt,
      requiredSkillId: input.requiredSkillId,
      headcount: input.headcount,
      notes: input.notes,
      createdById: user.id,
    },
  });
}

/**
 * Publishes all shifts in the Monday-start week containing the given date
 * (in the location's timezone). Enforces authorization via assertCanManageLocation.
 */
export async function publishWeek(
  user: SessionUser,
  locationId: string,
  weekOf: Date,
): Promise<{ count: number }> {
  await assertCanManageLocation(user, locationId);

  // Fetch location timezone for correct week-boundary calculation
  const location = await prisma.location.findUniqueOrThrow({
    where: { id: locationId },
    select: { timezone: true },
  });

  const { start, end } = weekBounds(weekOf, location.timezone);

  const result = await prisma.shift.updateMany({
    where: {
      locationId,
      startAt: {
        gte: start,
        lt: end,
      },
    },
    data: {
      status: "PUBLISHED",
    },
  });

  return { count: result.count };
}

/**
 * Unpublishes all shifts in the Monday-start week containing the given date
 * (in the location's timezone). Refuses entirely (with clear error) if any shift
 * in that week is within the 48-hour edit cutoff.
 * Enforces authorization via assertCanManageLocation.
 */
export async function unpublishWeek(
  user: SessionUser,
  locationId: string,
  weekOf: Date,
): Promise<{ count: number }> {
  await assertCanManageLocation(user, locationId);

  // Fetch location timezone for correct week-boundary calculation
  const location = await prisma.location.findUniqueOrThrow({
    where: { id: locationId },
    select: { timezone: true },
  });

  const { start, end } = weekBounds(weekOf, location.timezone);
  const now = new Date();

  // Check for any shifts within the cutoff
  const shiftsInWeek = await prisma.shift.findMany({
    where: {
      locationId,
      startAt: {
        gte: start,
        lt: end,
      },
      status: "PUBLISHED",
    },
  });

  const anyWithinCutoff = shiftsInWeek.some((shift) => {
    return isWithinEditCutoff(shift, now);
  });

  if (anyWithinCutoff) {
    throw new Error(
      `Cannot unpublish: at least one shift in this week is within the ${EDIT_CUTOFF_HOURS}-hour edit cutoff.`,
    );
  }

  // All checks passed, unpublish
  const result = await prisma.shift.updateMany({
    where: {
      locationId,
      startAt: {
        gte: start,
        lt: end,
      },
    },
    data: {
      status: "DRAFT",
    },
  });

  return { count: result.count };
}
