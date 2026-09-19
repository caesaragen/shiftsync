import { overlaps, gapMinutes } from "@/lib/time/intervals";
import { formatInstantClock, zoneAbbrev } from "@/lib/time/format";
import type { EngineContext, Violation } from "./types";

function formatGapText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${hours} hour${hours === 1 ? "" : "s"} ${mins} minute${mins === 1 ? "" : "s"}`;
}

/**
 * Conflict rules: double-booking and rest-gap violations.
 *
 * Returns ALL applicable violations; never short-circuits on the first,
 * so a manager sees the whole picture in one pass.
 */
export function checkConflicts(ctx: EngineContext): Violation[] {
  const violations: Violation[] = [];
  const candidateInterval = { start: ctx.shift.startAt, end: ctx.shift.endAt };

  for (const existing of ctx.existingAssignments) {
    const existingInterval = { start: existing.startAt, end: existing.endAt };

    // DOUBLE_BOOKING: does the candidate shift overlap with this existing assignment?
    if (overlaps(candidateInterval, existingInterval)) {
      // Render each shift in its own location's timezone for clarity.
      const candidateStartClock = formatInstantClock(ctx.shift.startAt, ctx.shift.locationTimezone);
      const candidateEndClock = formatInstantClock(ctx.shift.endAt, ctx.shift.locationTimezone);
      const candidateZone = zoneAbbrev(ctx.shift.startAt, ctx.shift.locationTimezone);

      const existingStartClock = formatInstantClock(existing.startAt, existing.locationTimezone);
      const existingEndClock = formatInstantClock(existing.endAt, existing.locationTimezone);
      const existingZone = zoneAbbrev(existing.startAt, existing.locationTimezone);

      const sameLocation = ctx.shift.locationId === existing.locationId;
      const sameZone = ctx.shift.locationTimezone === existing.locationTimezone;

      let message: string;
      if (sameLocation && sameZone) {
        // Simple case: same location, same timezone.
        message = `${ctx.staff.name} is already assigned to a shift at ${existing.locationName} from ${existingStartClock} to ${existingEndClock} ${existingZone}, which overlaps this one.`;
      } else if (sameZone) {
        // Different locations, same timezone.
        message = `${ctx.staff.name} is already assigned to a shift at ${existing.locationName} from ${existingStartClock} to ${existingEndClock} ${existingZone}, which overlaps this shift at ${ctx.shift.locationName}.`;
      } else {
        // Different timezones (common case: cross-location conflict).
        message = `${ctx.staff.name} is already assigned to a shift at ${existing.locationName} from ${existingStartClock} to ${existingEndClock} ${existingZone}, which overlaps this shift at ${ctx.shift.locationName} (${candidateStartClock}–${candidateEndClock} ${candidateZone}).`;
      }

      violations.push({
        rule: "DOUBLE_BOOKING",
        severity: "BLOCK",
        message,
      });
    } else {
      // REST_GAP: only check if shifts don't overlap.
      // Require at least 10 hours (600 minutes) between the end of one shift and start of the next.
      const gap = gapMinutes(candidateInterval, existingInterval);
      const minimumGapMinutes = 10 * 60; // 10 hours in minutes

      if (gap < minimumGapMinutes) {
        violations.push({
          rule: "REST_GAP",
          severity: "BLOCK",
          message: `Only ${formatGapText(gap)} between shifts; 10 hours are required.`,
        });
      }
    }
  }

  return violations;
}
