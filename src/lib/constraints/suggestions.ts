import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateAssignment } from "./engine";
import { weekBounds } from "@/lib/time/zones";
import { durationHours } from "@/lib/time/intervals";
import type { EngineContext } from "./types";

export type Suggestion = { staffId: string; name: string; reason: string };

type ShiftWithContext = Prisma.ShiftGetPayload<{
  include: { location: true; requiredSkill: true };
}>;

type AssignmentWithShift = Prisma.ShiftAssignmentGetPayload<{
  include: { shift: { include: { location: true } } };
}>;

type AvailabilityRow = Awaited<ReturnType<typeof prisma.availability.findMany>>[number];

/** Groups `rows` by `keyOf(row)`, preserving encounter order within each group. */
function groupBy<T, K>(rows: T[], keyOf: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = grouped.get(key);
    if (group) {
      group.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }
  return grouped;
}

/**
 * Builds one candidate's `EngineContext` entirely from already-fetched bulk
 * data -- no database access. This is what replaced the old per-candidate
 * `await loadContext(staffId, shiftId)` call: rule evaluation itself is
 * untouched (still the same `validateAssignment`), only the data plumbing
 * changed, so verdicts are identical to before.
 */
function buildCandidateContext(params: {
  shift: ShiftWithContext;
  staff: { id: string; name: string; homeTimezone: string };
  skills: { id: string; name: string }[];
  certifiedLocationIds: string[];
  availability: AvailabilityRow[];
  assignments: AssignmentWithShift[];
}): EngineContext {
  const { shift, staff, skills, certifiedLocationIds, availability, assignments } = params;

  const existingAssignments = assignments
    .filter((a) => a.shiftId !== shift.id)
    .map((a) => ({
      shiftId: a.shiftId,
      startAt: a.shift.startAt,
      endAt: a.shift.endAt,
      locationId: a.shift.locationId,
      locationName: a.shift.location.name,
      locationTimezone: a.shift.location.timezone,
    }));

  return {
    staff,
    shift: {
      id: shift.id,
      locationId: shift.locationId,
      locationName: shift.location.name,
      locationTimezone: shift.location.timezone,
      startAt: shift.startAt,
      endAt: shift.endAt,
      requiredSkillId: shift.requiredSkillId,
      requiredSkillName: shift.requiredSkill.name,
    },
    skills,
    activeCertificationLocationIds: certifiedLocationIds,
    availability,
    existingAssignments,
  };
}

/** Sum of hours from `assignments` whose shift starts within [weekStart, weekEnd). */
function hoursScheduledInWeek(
  assignments: AssignmentWithShift[],
  weekStart: Date,
  weekEnd: Date,
): number {
  let hours = 0;
  for (const assignment of assignments) {
    const assignmentStart = assignment.shift.startAt.getTime();
    if (assignmentStart >= weekStart.getTime() && assignmentStart < weekEnd.getTime()) {
      hours += durationHours({ start: assignment.shift.startAt, end: assignment.shift.endAt });
    }
  }
  return hours;
}

/**
 * Suggests alternative staff members for a shift.
 *
 * Finds staff who are:
 * - Certified at the shift's location (active certification only, endedAt IS NULL)
 * - Hold the required skill
 * - Are available for the shift
 * - Have no blocking conflicts
 *
 * Ranks by fewest hours already scheduled that week, so suggestions are
 * fairness-aware by construction (this is the behavior Phase 5's fairness
 * analytics rewards).
 *
 * Returns an empty array gracefully when nobody qualifies; the UI must be
 * able to say "no one is eligible" rather than crash.
 *
 * Runs a FIXED number of database queries no matter how many candidates are
 * certified at the location: everything (staff, skills, certifications,
 * assignments, availability) is bulk-fetched once up front, and each
 * candidate's `EngineContext` is built from that in-memory data (see
 * `buildCandidateContext`) instead of re-querying per candidate.
 *
 * @param shiftId - The shift to find alternatives for
 * @param excludeStaffId - Optional staff ID to exclude (e.g., the one who just failed)
 */
export async function suggestAlternatives(
  shiftId: string,
  excludeStaffId?: string,
): Promise<Suggestion[]> {
  // Fetch the shift and its location
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: { location: true, requiredSkill: true },
  });

  if (!shift) {
    return [];
  }

  // Find all staff certified at this location (active certifications only)
  const certifications = await prisma.staffLocationCertification.findMany({
    where: {
      locationId: shift.locationId,
      endedAt: null,
    },
    include: { staff: true },
  });

  if (certifications.length === 0) {
    return [];
  }

  const certifiedStaffIds = certifications
    .map((c) => c.staffId)
    .filter((id) => id !== excludeStaffId);

  if (certifiedStaffIds.length === 0) {
    return [];
  }

  // Everything a candidate's EngineContext could need, fetched once for ALL
  // candidates rather than once per candidate.
  const [staff, staffSkills, assignments, availabilityRows] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: certifiedStaffIds } } }),
    prisma.staffSkill.findMany({
      where: { staffId: { in: certifiedStaffIds } },
      include: { skill: true },
    }),
    prisma.shiftAssignment.findMany({
      where: { staffId: { in: certifiedStaffIds } },
      include: { shift: { include: { location: true } } },
    }),
    prisma.availability.findMany({ where: { staffId: { in: certifiedStaffIds } } }),
  ]);

  // Group the bulk data by staffId for O(1) lookup per candidate below.
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const skillsByStaffId = groupBy(staffSkills, (ss) => ss.staffId);
  const certLocationsByStaffId = groupBy(certifications, (c) => c.staffId);
  const availabilityByStaffId = groupBy(availabilityRows, (a) => a.staffId);
  const assignmentsByStaffId = groupBy(assignments, (a) => a.staffId);

  const candidates: Array<{ staffId: string; name: string; hoursThisWeek: number }> = [];

  for (const staffId of certifiedStaffIds) {
    const s = staffById.get(staffId);
    if (!s) continue;

    const skills = (skillsByStaffId.get(staffId) ?? []).map((ss) => ({
      id: ss.skill.id,
      name: ss.skill.name,
    }));
    if (!skills.some((skill) => skill.id === shift.requiredSkillId)) {
      continue;
    }

    const ctx = buildCandidateContext({
      shift,
      staff: { id: s.id, name: s.name, homeTimezone: s.homeTimezone },
      skills,
      certifiedLocationIds: (certLocationsByStaffId.get(staffId) ?? []).map((c) => c.locationId),
      availability: availabilityByStaffId.get(staffId) ?? [],
      assignments: assignmentsByStaffId.get(staffId) ?? [],
    });

    const result = validateAssignment(ctx);
    if (!result.allowed) {
      continue;
    }

    const { start: weekStart, end: weekEnd } = weekBounds(shift.startAt, s.homeTimezone);
    const hoursThisWeek = hoursScheduledInWeek(
      assignmentsByStaffId.get(staffId) ?? [],
      weekStart,
      weekEnd,
    );

    candidates.push({ staffId, name: s.name, hoursThisWeek });
  }

  // Sort by fewest hours scheduled this week (fairness-aware)
  candidates.sort((a, b) => a.hoursThisWeek - b.hoursThisWeek);

  // Map to suggestions with concrete reasons
  return candidates.map((c) => ({
    staffId: c.staffId,
    name: c.name,
    reason: `Has ${shift.requiredSkill.name}, certified at ${shift.location.name}, ${Math.round(c.hoursThisWeek)} hours scheduled this week`,
  }));
}
