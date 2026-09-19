import { prisma } from "@/lib/prisma";
import { loadContext, validateAssignment } from "./engine";
import { weekBounds } from "@/lib/time/zones";
import { durationHours } from "@/lib/time/intervals";

export type Suggestion = { staffId: string; name: string; reason: string };

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

  // Fetch all staff records for the certified staff
  const staff = await prisma.user.findMany({
    where: { id: { in: certifiedStaffIds } },
  });

  // Fetch skills for all certified staff
  const staffSkills = await prisma.staffSkill.findMany({
    where: { staffId: { in: certifiedStaffIds } },
    include: { skill: true },
  });

  // Fetch existing assignments for all certified staff
  const assignments = await prisma.shiftAssignment.findMany({
    where: { staffId: { in: certifiedStaffIds } },
    include: { shift: { include: { location: true } } },
  });

  // Build maps for quick lookup
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const skillsByStaffId = new Map<string, Set<string>>();
  for (const ss of staffSkills) {
    if (!skillsByStaffId.has(ss.staffId)) {
      skillsByStaffId.set(ss.staffId, new Set());
    }
    skillsByStaffId.get(ss.staffId)!.add(ss.skillId);
  }

  // Now filter and validate each certified staff member
  const candidates: Array<{
    staffId: string;
    name: string;
    hoursThisWeek: number;
  }> = [];

  for (const staffId of certifiedStaffIds) {
    const s = staffById.get(staffId);
    if (!s) continue;

    // Check if staff has the required skill
    const skills = skillsByStaffId.get(staffId) || new Set();
    if (!skills.has(shift.requiredSkillId)) {
      continue;
    }

    // Load context and validate the assignment
    try {
      const ctx = await loadContext(staffId, shiftId);
      const result = validateAssignment(ctx);

      // Include only if there are no blocking violations
      if (!result.allowed) {
        continue;
      }

      // Calculate hours scheduled this week
      const weekStart = weekBounds(shift.startAt, s.homeTimezone).start;
      const weekEnd = weekBounds(shift.startAt, s.homeTimezone).end;

      let hoursThisWeek = 0;
      for (const assignment of assignments) {
        if (assignment.staffId === staffId) {
          const assignmentStart = assignment.shift.startAt.getTime();
          if (assignmentStart >= weekStart.getTime() && assignmentStart < weekEnd.getTime()) {
            hoursThisWeek += durationHours({
              start: assignment.shift.startAt,
              end: assignment.shift.endAt,
            });
          }
        }
      }

      candidates.push({
        staffId,
        name: s.name,
        hoursThisWeek,
      });
    } catch {
      // Skip this staff member if context loading fails
      continue;
    }
  }

  // Sort by fewest hours scheduled this week (fairness-aware)
  candidates.sort((a, b) => a.hoursThisWeek - b.hoursThisWeek);

  // Map to suggestions with concrete reasons
  const suggestions: Suggestion[] = candidates.map((c) => ({
    staffId: c.staffId,
    name: c.name,
    reason: `Has ${shift.requiredSkill.name}, certified at ${shift.location.name}, ${Math.round(c.hoursThisWeek)} hours scheduled this week`,
  }));

  return suggestions;
}
