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
 */
export async function loadContext(staffId: string, shiftId: string): Promise<EngineContext> {
  // Fetch the shift with its location, skill, and assignments
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
  });

  if (!shift) {
    throw new Error(`Shift ${shiftId} not found`);
  }

  const [
    staff,
    location,
    requiredSkill,
    staffSkills,
    activeCertifications,
    availability,
    allAssignments,
  ] = await Promise.all([
    prisma.user.findUnique({ where: { id: staffId } }),
    prisma.location.findUnique({ where: { id: shift.locationId } }),
    prisma.skill.findUnique({ where: { id: shift.requiredSkillId } }),
    prisma.staffSkill.findMany({
      where: { staffId },
      include: { skill: true },
    }),
    prisma.staffLocationCertification.findMany({
      where: { staffId, endedAt: null },
    }),
    prisma.availability.findMany({ where: { staffId } }),
    prisma.shiftAssignment.findMany({
      where: { staffId },
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
