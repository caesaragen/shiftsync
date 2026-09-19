import { DateTime } from "luxon";

/**
 * Timezone-aware conversions between UTC instants (JS `Date`) and local wall
 * clock in an IANA zone. All zoned math goes through Luxon's `DateTime` so
 * DST transitions are handled correctly. Never hand-roll UTC offset
 * arithmetic and never use `Date#setHours` for zoned logic -- both silently
 * assume a fixed offset and break on DST transition days.
 */

export function toZoned(instant: Date, timeZone: string): DateTime {
  return DateTime.fromJSDate(instant, { zone: timeZone });
}

/** "2026-03-08" -- the calendar date `instant` falls on in `timeZone`. */
export function localDateKey(instant: Date, timeZone: string): string {
  return toZoned(instant, timeZone).toFormat("yyyy-MM-dd");
}

/**
 * Minutes since local midnight, wall-clock based (i.e. `hour * 60 +
 * minute`), matching how `Availability.startMinutes` / `endMinutes` are
 * defined. Deliberately NOT elapsed-time-since-midnight -- on a
 * spring-forward day the 02:00-03:00 hour doesn't exist locally, but a shift
 * that reads 04:30 on the clock must still report 270, not the lesser
 * elapsed duration.
 */
export function minutesSinceLocalMidnight(instant: Date, timeZone: string): number {
  const zoned = toZoned(instant, timeZone);
  return zoned.hour * 60 + zoned.minute + zoned.second / 60 + zoned.millisecond / 60000;
}

/**
 * The Monday 00:00 (local) through the following Monday 00:00 (local)
 * bounding `instant`'s week, returned as UTC instants. Computed via
 * Luxon calendar-day arithmetic (`plus`/`minus` on a `DateTime`), which
 * preserves local wall-clock time across DST transitions -- a week
 * containing a transition is still exactly 7 *local* days even though it is
 * 167 or 169 real elapsed hours rather than 168.
 */
export function weekBounds(instant: Date, timeZone: string): { start: Date; end: Date } {
  const zoned = toZoned(instant, timeZone);
  const daysFromMonday = zoned.weekday - 1; // Luxon weekday: 1=Mon .. 7=Sun
  const start = zoned.startOf("day").minus({ days: daysFromMonday });
  const end = start.plus({ days: 7 });
  return { start: start.toJSDate(), end: end.toJSDate() };
}

/**
 * `instant` shifted by `days` local calendar days, preserving local
 * wall-clock time. Uses Luxon's calendar-unit `plus`, not millisecond
 * arithmetic -- adding `days * 86_400_000` ms would drift by an hour across
 * a DST transition (e.g. 09:00 -> 10:00 across spring-forward).
 */
export function addLocalDays(instant: Date, timeZone: string, days: number): Date {
  return toZoned(instant, timeZone).plus({ days }).toJSDate();
}
