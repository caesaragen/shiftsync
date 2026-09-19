import { isStaffAvailable } from "@/lib/availability";
import type { EngineContext, Violation } from "./types";

/**
 * Eligibility rules: can this staff member work this shift at all, setting
 * aside conflicts with their other shifts (Task 5) and hours limits (Task
 * 6)? All three violations here are BLOCK -- there is no "override" for a
 * missing skill, a lapsed certification, or being unavailable.
 *
 * Returns ALL applicable violations, never short-circuiting on the first,
 * so a manager sees the whole picture in one pass rather than fixing one
 * problem only to hit the next on resubmission.
 */
export function checkEligibility(ctx: EngineContext): Violation[] {
  const violations: Violation[] = [];

  if (!ctx.skillIds.includes(ctx.shift.requiredSkillId)) {
    violations.push({
      rule: "SKILL_MISMATCH",
      severity: "BLOCK",
      message: `${ctx.staff.name} does not have the skill required for this shift (skill ${ctx.shift.requiredSkillId}).`,
    });
  }

  if (!ctx.activeCertificationLocationIds.includes(ctx.shift.locationId)) {
    violations.push({
      rule: "NOT_CERTIFIED",
      severity: "BLOCK",
      message: `${ctx.staff.name} is not certified to work at location ${ctx.shift.locationId}.`,
    });
  }

  const availability = isStaffAvailable(ctx.availability, ctx.shift, ctx.staff.homeTimezone);
  if (!availability.available) {
    // `availability.reason` is deliberately phrased (lowercase, "available
    // X, but this shift runs Y") to read naturally after "{name} is ".
    violations.push({
      rule: "UNAVAILABLE",
      severity: "BLOCK",
      message: `${ctx.staff.name} is ${availability.reason ?? "not available for this shift."}`,
    });
  }

  return violations;
}
