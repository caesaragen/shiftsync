import type { Availability } from "@prisma/client";
import { DateTime } from "luxon";
import { toZoned, localDateKey, minutesSinceLocalMidnight } from "@/lib/time/zones";
import { formatClockMinutes, zoneAbbrev } from "@/lib/time/format";

/**
 * A single availability window expressed in local minutes-since-midnight,
 * as stored on `Availability.startMinutes`/`endMinutes`. `endMinutes` may
 * exceed 1440 to express a window that crosses local midnight (e.g.
 * 22:00-02:00 is `{ startMinutes: 1320, endMinutes: 1560 }`).
 */
export type AvailabilityWindow = { startMinutes: number; endMinutes: number; isAvailable: boolean };

const MINUTES_PER_DAY = 1440;

/** A half-open-by-value minute range on a continuous axis anchored at the shift's start-day local midnight. */
type Interval = { start: number; end: number };

/**
 * `Availability.date` is `@db.Date` -- a pure calendar date with no time
 * component or zone attached. Prisma represents it as a JS `Date` at UTC
 * midnight, so it must be read back out in UTC (never in the staff
 * member's zone, which could roll it to the wrong day).
 */
function dateOnlyKey(d: Date): string {
  return DateTime.fromJSDate(d, { zone: "utc" }).toFormat("yyyy-MM-dd");
}

/**
 * The rows that govern a given local calendar date. An EXCEPTION row for
 * that date overrides ALL RECURRING rows for that date -- whether it
 * grants or denies availability -- so if any EXCEPTION exists for the
 * date, RECURRING rows are ignored entirely for that date.
 */
function effectiveRowsForDate(
  rows: Availability[],
  dateKey: string,
  weekday: number,
): Availability[] {
  const exceptions = rows.filter(
    (r) => r.kind === "EXCEPTION" && r.date !== null && dateOnlyKey(r.date) === dateKey,
  );
  if (exceptions.length > 0) return exceptions;
  return rows.filter((r) => r.kind === "RECURRING" && r.dayOfWeek === weekday);
}

/**
 * Available (isAvailable: true) windows for a local calendar date,
 * translated onto the continuous axis via `offsetMinutes` (0 for the
 * shift's start day, +1440 for the day after, so a window can be merged
 * with the start day's windows and checked for continuous coverage).
 */
function availableIntervalsForDate(
  rows: Availability[],
  dateKey: string,
  weekday: number,
  offsetMinutes: number,
): Interval[] {
  return effectiveRowsForDate(rows, dateKey, weekday)
    .filter((r) => r.isAvailable)
    .map((r) => ({ start: r.startMinutes + offsetMinutes, end: r.endMinutes + offsetMinutes }));
}

/** Merge overlapping or abutting intervals (e.g. 09:00-12:00 + 12:00-17:00 -> 09:00-17:00). */
function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

/** True only if a single merged interval fully contains `target` (start-to-end, not merely overlaps it). */
function isCovered(target: Interval, merged: Interval[]): boolean {
  return merged.some((iv) => iv.start <= target.start && target.end <= iv.end);
}

function formatRange(start: number, end: number): string {
  return `${formatClockMinutes(start)}–${formatClockMinutes(end)}`;
}

/**
 * Whether a staff member is available for the ENTIRE duration of `shift`,
 * per their availability rows. The shift's absolute instants are converted
 * into `homeTimeZone` and compared against windows expressed in local
 * minutes -- a shift that starts inside a window but runs past its close
 * is NOT available, and a shift crossing local midnight is checked against
 * both the start day's and end day's windows. No matching window at all
 * means unavailable (fail closed).
 */
export function isStaffAvailable(
  rows: Availability[],
  shift: { startAt: Date; endAt: Date },
  homeTimeZone: string,
): { available: boolean; reason?: string } {
  const startZoned = toZoned(shift.startAt, homeTimeZone);
  const endZoned = toZoned(shift.endAt, homeTimeZone);

  const startDateKey = localDateKey(shift.startAt, homeTimeZone);
  const endDateKey = localDateKey(shift.endAt, homeTimeZone);
  const crossesMidnight = endDateKey !== startDateKey;

  const shiftStartRel = minutesSinceLocalMidnight(shift.startAt, homeTimeZone);
  const shiftEndRel = crossesMidnight
    ? MINUTES_PER_DAY + minutesSinceLocalMidnight(shift.endAt, homeTimeZone)
    : minutesSinceLocalMidnight(shift.endAt, homeTimeZone);
  const target: Interval = { start: shiftStartRel, end: shiftEndRel };

  const day1Intervals = availableIntervalsForDate(rows, startDateKey, startZoned.weekday, 0);
  const day2Intervals = crossesMidnight
    ? availableIntervalsForDate(rows, endDateKey, endZoned.weekday, MINUTES_PER_DAY)
    : [];
  const merged = mergeIntervals([...day1Intervals, ...day2Intervals]);

  if (isCovered(target, merged)) {
    return { available: true };
  }

  // Zone abbreviation (e.g. "EDT") so the reason is unambiguous about which
  // clock the times below are read on -- both the window and the shift are
  // expressed in the SAME zone (the staff member's home zone) here, since
  // that is all this function is given; a caller with more context (staff
  // name, shift location) can layer that on top of this reason.
  const zoneLabel = zoneAbbrev(shift.startAt, homeTimeZone);
  const shiftRangeText = `${formatRange(shiftStartRel, shiftEndRel)} ${zoneLabel}`;

  // Deliberately lowercase and phrased to read naturally when a caller
  // composes "{staff name} is {reason}" (see constraints/eligibility.ts).
  if (merged.length === 0) {
    return {
      available: false,
      reason: `not scheduled to work on ${startZoned.toFormat("cccc, LLLL d")}, but this shift runs ${shiftRangeText}.`,
    };
  }

  const windowsText = merged.map((iv) => formatRange(iv.start, iv.end)).join(" and ");
  return {
    available: false,
    reason: `available ${windowsText} ${zoneLabel}, but this shift runs ${shiftRangeText}.`,
  };
}

/**
 * A human-readable summary of `rows`' availability windows on the local
 * calendar date `instant` falls on in `homeTimeZone` -- independent of any
 * particular shift's hours, unlike `isStaffAvailable` (which only reports a
 * reason when a specific shift DOESN'T fit). Lets a caller show a manager
 * what a candidate's actual hours are that day, not just whether they
 * happen to cover the one shift being considered right now.
 */
export function describeAvailabilityForDate(
  rows: Availability[],
  instant: Date,
  homeTimeZone: string,
): string {
  const dateKey = localDateKey(instant, homeTimeZone);
  const weekday = toZoned(instant, homeTimeZone).weekday;
  const merged = mergeIntervals(availableIntervalsForDate(rows, dateKey, weekday, 0));

  if (merged.length === 0) {
    return "Not scheduled to work this day";
  }

  const zoneLabel = zoneAbbrev(instant, homeTimeZone);
  const windowsText = merged.map((iv) => formatRange(iv.start, iv.end)).join(" and ");
  return `${windowsText} ${zoneLabel}`;
}
