import { localDateKey, weekBounds, toZoned } from "@/lib/time/zones";
import { durationHours } from "@/lib/time/intervals";
import type { EngineContext, Violation } from "./types";

/**
 * Helper to format a date string like "2026-06-20" into "Mon Jun 20".
 *
 * `dateStr` is a calendar-date key (from `localDateKey`) already resolved
 * in the staff member's own home timezone -- it isn't a UTC instant, just
 * "which day this is." The `Date` built from it is anchored to UTC
 * midnight, so the weekday/month/day MUST also be read back out via
 * explicit `timeZone: "UTC"` -- without it, `toLocaleDateString` falls back
 * to the RUNTIME's own local system timezone, and for a runtime behind UTC
 * (any US zone) that reads UTC midnight as the previous day, silently
 * naming the wrong weekday in a violation message. This has coincidentally
 * never surfaced because this app's actual deployment runtime happens to
 * default to UTC -- exactly the kind of latent, environment-dependent bug
 * this codebase has hit repeatedly elsewhere.
 */
function formatDateString(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Hours constraint rules: daily limits, weekly limits, and consecutive-day rules.
 *
 * All totals are computed **including** the candidate shift, evaluated in the
 * staff member's `homeTimezone`.
 *
 * Returns ALL applicable violations; never short-circuits on the first, so a
 * manager sees the whole picture in one pass.
 */
export function checkHours(ctx: EngineContext): Violation[] {
  const violations: Violation[] = [];
  const tz = ctx.staff.homeTimezone;

  // Get the candidate shift's local date and week
  const candidateLocalDate = localDateKey(ctx.shift.startAt, tz);
  const { start: weekStart, end: weekEnd } = weekBounds(ctx.shift.startAt, tz);

  // Collect all assignments (existing + candidate) for the relevant date and week
  const candidateDuration = durationHours({ start: ctx.shift.startAt, end: ctx.shift.endAt });

  // --- DAILY HOURS ---
  let dailyHours = candidateDuration;
  for (const existing of ctx.existingAssignments) {
    if (localDateKey(existing.startAt, tz) === candidateLocalDate) {
      dailyHours += durationHours({ start: existing.startAt, end: existing.endAt });
    }
  }

  if (dailyHours > 12.0) {
    violations.push({
      rule: "DAILY_HOURS_BLOCK",
      severity: "BLOCK",
      message: `Assigning this shift puts ${ctx.staff.name} at ${dailyHours.toFixed(1)} hours on ${formatDateString(candidateLocalDate)}, exceeding the 12-hour daily limit.`,
    });
  } else if (dailyHours > 8.0) {
    violations.push({
      rule: "DAILY_HOURS_WARN",
      severity: "WARN",
      message: `Assigning this shift puts ${ctx.staff.name} at ${dailyHours.toFixed(1)} hours on ${formatDateString(candidateLocalDate)}, exceeding the 8-hour threshold.`,
    });
  }

  // --- WEEKLY HOURS ---
  let weeklyHours = candidateDuration;
  for (const existing of ctx.existingAssignments) {
    const existingStart = existing.startAt.getTime();
    if (existingStart >= weekStart.getTime() && existingStart < weekEnd.getTime()) {
      weeklyHours += durationHours({ start: existing.startAt, end: existing.endAt });
    }
  }

  if (weeklyHours >= 35.0) {
    // Format the week date range: "Mon Jun 15 – Sun Jun 21"
    // weekStart is Monday 00:00 local, weekEnd is Monday 00:00 local next week
    // So we want Monday to Sunday (1 day before weekEnd)
    const weekStartZoned = toZoned(weekStart, tz);
    const weekEndZoned = toZoned(new Date(weekEnd.getTime() - 1), tz);

    const weekStartStr = weekStartZoned.toFormat("ccc LLL d");
    const weekEndStr = weekEndZoned.toFormat("ccc LLL d");

    violations.push({
      rule: "WEEKLY_HOURS_WARN",
      severity: "WARN",
      message: `Assigning this shift puts ${ctx.staff.name} at ${weeklyHours.toFixed(1)} hours this week (${weekStartStr} – ${weekEndStr}), past the 35-hour weekly threshold.`,
    });
  }

  // --- CONSECUTIVE DAYS ---
  // Count how many consecutive days worked, including the candidate
  const workedDates = new Set<string>();

  // Add all existing assignments' dates
  for (const existing of ctx.existingAssignments) {
    workedDates.add(localDateKey(existing.startAt, tz));
  }

  // Add the candidate's date
  workedDates.add(candidateLocalDate);

  // Count the longest consecutive streak ending on or after the candidate's date
  const sortedDates = Array.from(workedDates).sort();
  const candidateDateIndex = sortedDates.indexOf(candidateLocalDate);

  let consecutiveCount = 1;
  let currentDateIndex = candidateDateIndex;

  // Look backwards from the candidate date to find the start of the streak
  while (currentDateIndex > 0) {
    const currentDate = new Date(sortedDates[currentDateIndex]);
    const prevDate = new Date(sortedDates[currentDateIndex - 1]);
    const diffDays = Math.floor(
      (currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (diffDays === 1) {
      consecutiveCount++;
      currentDateIndex--;
    } else {
      break;
    }
  }

  if (consecutiveCount >= 7) {
    violations.push({
      rule: "SEVENTH_CONSECUTIVE_DAY",
      severity: "OVERRIDE_REQUIRED",
      message: `Assigning this shift makes ${ctx.staff.name}'s 7th consecutive worked day (${formatDateString(candidateLocalDate)}). An override reason is required.`,
    });
  } else if (consecutiveCount === 6) {
    violations.push({
      rule: "SIXTH_CONSECUTIVE_DAY",
      severity: "WARN",
      message: `Assigning this shift makes ${ctx.staff.name}'s 6th consecutive worked day (${formatDateString(candidateLocalDate)}).`,
    });
  }

  return violations;
}
