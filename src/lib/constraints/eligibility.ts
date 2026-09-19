import { isStaffAvailable } from "@/lib/availability";
import { formatInstantClock, zoneAbbrev } from "@/lib/time/format";
import type { EngineContext, Violation } from "./types";

/** "a" / "a and b" / "a, b, and c" -- Oxford-comma joined list, for naming what a staff member has. */
function joinWithAnd(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/**
 * `isStaffAvailable`'s reason is a full sentence of the form "available X,
 * but this shift runs Y." -- here we only want the "available X" clause,
 * because the caller (below) states the shift's conflicting time itself,
 * with full location/home zone context Task 3's matcher doesn't have.
 */
function availabilityClauseOnly(reason: string | undefined): string {
  if (!reason) return "not available for this shift";
  return reason.split(/,\s*but\s+/)[0];
}

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

  // Matching is always by id, per EngineContext's contract -- names exist
  // only so the message below can say what the shift needs and what the
  // staff member has, instead of leaking opaque ids into manager-facing text.
  const hasRequiredSkill = ctx.skills.some((s) => s.id === ctx.shift.requiredSkillId);
  if (!hasRequiredSkill) {
    const haveNames = ctx.skills.map((s) => s.name);
    const haveText = haveNames.length > 0 ? joinWithAnd(haveNames) : "no listed skills";
    violations.push({
      rule: "SKILL_MISMATCH",
      severity: "BLOCK",
      message: `This shift requires ${ctx.shift.requiredSkillName}. ${ctx.staff.name} has ${haveText}.`,
    });
  }

  if (!ctx.activeCertificationLocationIds.includes(ctx.shift.locationId)) {
    const others = ctx.activeCertificationLocationIds.filter((id) => id !== ctx.shift.locationId);
    const locationNoun = others.length === 1 ? "location" : "locations";
    const elsewhereClause =
      others.length > 0
        ? ` ${ctx.staff.name} is certified at ${others.length} other ${locationNoun}.`
        : "";
    violations.push({
      rule: "NOT_CERTIFIED",
      severity: "BLOCK",
      message: `${ctx.staff.name} isn't certified to work at ${ctx.shift.locationName}.${elsewhereClause}`,
    });
  }

  const availability = isStaffAvailable(ctx.availability, ctx.shift, ctx.staff.homeTimezone);
  if (!availability.available) {
    const sameZone = ctx.shift.locationTimezone === ctx.staff.homeTimezone;

    // The shift's time as the manager who posted it sees it -- in the
    // shift's OWN location zone.
    const locationRange = `${formatInstantClock(ctx.shift.startAt, ctx.shift.locationTimezone)}–${formatInstantClock(ctx.shift.endAt, ctx.shift.locationTimezone)}`;
    const locationZone = zoneAbbrev(ctx.shift.startAt, ctx.shift.locationTimezone);

    let timeSentence = `This shift runs ${locationRange} ${locationZone} at ${ctx.shift.locationName}.`;
    if (!sameZone) {
      // The SAME shift, converted into the staff member's home zone --
      // this is the number that actually conflicts with their availability
      // window below, and it's what makes a cross-timezone mismatch
      // self-explanatory instead of merely asserted.
      const homeRange = `${formatInstantClock(ctx.shift.startAt, ctx.staff.homeTimezone)}–${formatInstantClock(ctx.shift.endAt, ctx.staff.homeTimezone)}`;
      const homeZone = zoneAbbrev(ctx.shift.startAt, ctx.staff.homeTimezone);
      timeSentence = `This shift runs ${locationRange} ${locationZone} at ${ctx.shift.locationName}, which is ${homeRange} ${homeZone} in ${ctx.staff.name}'s home timezone.`;
    }

    const availabilitySentence = `${ctx.staff.name} is ${availabilityClauseOnly(availability.reason)}.`;

    violations.push({
      rule: "UNAVAILABLE",
      severity: "BLOCK",
      message: `${timeSentence} ${availabilitySentence}`,
    });
  }

  return violations;
}
