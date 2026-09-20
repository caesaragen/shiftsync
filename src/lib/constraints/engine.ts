import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkEligibility } from "./eligibility";
import { checkConflicts } from "./conflicts";
import { checkHours } from "./hours";
import type { EngineContext, Violation } from "./types";

export type ValidationResult = {
  allowed: boolean;
  requiresOverride: boolean;
  violations: Violation[];
};

/**
 * How far, in days, either side of the candidate shift's `startAt` the
 * assignment-history query reaches. Chosen deliberately wide -- a too-narrow
 * window silently under-reports violations, which is far worse than fetching
 * a few extra rows.
 *
 * Worst case this needs to cover, entirely in the STAFF MEMBER's local
 * calendar:
 * - The Monday-start week window (`weekBounds`): if the candidate shift
 *   lands on a Sunday (the last day of its week), the week's Monday start
 *   is up to 6 local days earlier. If it lands on a Monday (the first day),
 *   the week's last day (Sunday) is up to 6 local days later. So the weekly
 *   hours total alone needs +/-6 local days.
 * - The 7-consecutive-day streak (`checkHours`): counts backward from the
 *   candidate's local date and needs up to 6 prior local days to reach a
 *   7-day streak.
 * So the rules themselves need at most 6 days on either side.
 *
 * On top of that, `startAt` is a UTC instant, but "6 local days" is measured
 * in the staff member's home-timezone calendar, and this query runs before
 * that timezone conversion happens (it's a plain UTC range on `startAt`, so
 * the window and the DB round trip don't depend on first loading the staff
 * record). IANA offsets range from UTC-12 to UTC+14, so a local calendar day
 * can fall up to a day earlier or later than the UTC day containing the same
 * instant. Padding the 6-day rule requirement by that offset slop rounds up
 * to 9 days, which is also comfortably wide for DST transition weeks (which
 * are only ever off by an hour, not a day).
 */
const ASSIGNMENT_HISTORY_WINDOW_DAYS = 9;

/**
 * The `[start, end]` UTC bounds (inclusive) that
 * `ASSIGNMENT_HISTORY_WINDOW_DAYS` maps to around a candidate shift's
 * `startAt`. See that constant's doc comment for why 9 days is sufficient.
 */
function assignmentHistoryWindow(shiftStartAt: Date): { start: Date; end: Date } {
  const windowMs = ASSIGNMENT_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return {
    start: new Date(shiftStartAt.getTime() - windowMs),
    end: new Date(shiftStartAt.getTime() + windowMs),
  };
}

/**
 * Composes all three constraint rule modules: eligibility, conflicts, and hours.
 *
 * Returns `allowed: false` if ANY violation has severity BLOCK.
 * Returns `requiresOverride: true` if there is an OVERRIDE_REQUIRED and no BLOCK.
 * Returns ALL violations (does not short-circuit) so a manager sees the whole picture.
 */
export function validateAssignment(ctx: EngineContext): ValidationResult {
  const violations: Violation[] = [];

  // Collect violations from all three rule modules.
  violations.push(...checkEligibility(ctx));
  violations.push(...checkConflicts(ctx));
  violations.push(...checkHours(ctx));

  // Determine the result based on severity levels.
  const hasBlock = violations.some((v) => v.severity === "BLOCK");
  const hasOverrideRequired = violations.some((v) => v.severity === "OVERRIDE_REQUIRED");

  return {
    allowed: !hasBlock,
    requiresOverride: !hasBlock && hasOverrideRequired,
    violations,
  };
}

/**
 * Loads the constraint engine context from the database. This is the ONLY
 * database-touching function in this module. It populates every field
 * required by EngineContext, including display names needed for violation messages.
 *
 * Key invariants:
 * - The candidate shift itself is EXCLUDED from existingAssignments (so we don't
 *   report a conflict with itself).
 * - Only ACTIVE certifications count (endedAt IS NULL).
 *
 * `client` defaults to the global `prisma` singleton so existing callers are
 * unaffected, but callers that need read-your-writes consistency inside a
 * transaction (e.g. `assignStaffToShift`) can pass the transaction client
 * (`Prisma.TransactionClient`) so the context read and the eventual write
 * happen against the SAME transaction/connection.
 */
export async function loadContext(
  staffId: string,
  shiftId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<EngineContext> {
  // Fetch the shift with its location, skill, and assignments
  const shift = await client.shift.findUnique({
    where: { id: shiftId },
  });

  if (!shift) {
    throw new Error(`Shift ${shiftId} not found`);
  }

  // See ASSIGNMENT_HISTORY_WINDOW_DAYS' doc comment for why 9 days either
  // side is wide enough to cover everything checkHours needs.
  const historyWindow = assignmentHistoryWindow(shift.startAt);

  const [
    staff,
    location,
    requiredSkill,
    staffSkills,
    activeCertifications,
    availability,
    allAssignments,
  ] = await Promise.all([
    client.user.findUnique({ where: { id: staffId } }),
    client.location.findUnique({ where: { id: shift.locationId } }),
    client.skill.findUnique({ where: { id: shift.requiredSkillId } }),
    client.staffSkill.findMany({
      where: { staffId },
      include: { skill: true },
    }),
    client.staffLocationCertification.findMany({
      where: { staffId, endedAt: null },
    }),
    client.availability.findMany({ where: { staffId } }),
    client.shiftAssignment.findMany({
      where: {
        staffId,
        shift: { startAt: { gte: historyWindow.start, lte: historyWindow.end } },
      },
      include: { shift: { include: { location: true } } },
    }),
  ]);

  if (!staff) {
    throw new Error(`Staff member ${staffId} not found`);
  }

  if (!location) {
    throw new Error(`Location ${shift.locationId} not found`);
  }

  if (!requiredSkill) {
    throw new Error(`Skill ${shift.requiredSkillId} not found`);
  }

  // Filter out the candidate shift from existingAssignments
  const existingAssignments = allAssignments
    .filter((a) => a.shiftId !== shiftId)
    .map((a) => ({
      shiftId: a.shiftId,
      startAt: a.shift.startAt,
      endAt: a.shift.endAt,
      locationId: a.shift.locationId,
      locationName: a.shift.location.name,
      locationTimezone: a.shift.location.timezone,
    }));

  return {
    staff: {
      id: staff.id,
      name: staff.name,
      homeTimezone: staff.homeTimezone,
    },
    shift: {
      id: shift.id,
      locationId: shift.locationId,
      locationName: location.name,
      locationTimezone: location.timezone,
      startAt: shift.startAt,
      endAt: shift.endAt,
      requiredSkillId: shift.requiredSkillId,
      requiredSkillName: requiredSkill.name,
    },
    skills: staffSkills.map((ss) => ({
      id: ss.skill.id,
      name: ss.skill.name,
    })),
    activeCertificationLocationIds: activeCertifications.map((c) => c.locationId),
    availability,
    existingAssignments,
  };
}
