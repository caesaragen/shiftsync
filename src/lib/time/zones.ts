import { DateTime } from "luxon";

/**
 * Timezone-aware conversions between UTC instants (JS `Date`) and local wall
 * clock in an IANA zone. All zoned math goes through Luxon's `DateTime` so
 * DST transitions are handled correctly. Never hand-roll UTC offset
 * arithmetic and never use `Date#setHours` for zoned logic -- both silently
 * assume a fixed offset and break on DST transition days.
 */

/**
 * Parse a bare "YYYY-MM-DD" string safely as a calendar date, not as UTC midnight.
 *
 * JavaScript's `new Date("YYYY-MM-DD")` interprets the string as UTC midnight
 * (e.g., "2026-09-14" → 2026-09-14T00:00:00.000Z). For timezones behind UTC
 * (all US zones), this instant falls on the *previous* calendar day locally
 * (e.g., EDT is UTC-4, so UTC midnight becomes the previous day 8 PM). This
 * breaks week-boundary and day-boundary calculations.
 *
 * This function anchors to noon UTC instead, which is safe for all real-world
 * zones this app uses (US zones are UTC-4 to UTC-8): noon UTC cannot cross
 * into a different local day for offsets within +/-12 hours.
 */
export function parseDateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00.000Z`);
}

export function toZoned(instant: Date, timeZone: string): DateTime {
  return DateTime.fromJSDate(instant, { zone: timeZone });
}

/**
 * Parse a datetime-local string (e.g. "2027-01-15T09:00", as produced by an
 * `<input type="datetime-local">`) as wall-clock time IN `timeZone`.
 *
 * These strings carry no timezone designator. JavaScript's `new
 * Date("2027-01-15T09:00")` interprets a date-TIME string with no offset in
 * the RUNTIME's own local system timezone -- not the browser's zone, and
 * not whatever zone the value is semantically meant to represent (e.g. the
 * timezone of the location a shift belongs to). On Vercel that runtime zone
 * is typically UTC; locally it's whatever the machine is set to. Either way
 * it is essentially never the zone the caller actually meant, so every
 * value parsed this way is silently wrong by the gap between those two
 * zones. Always route a datetime-local value through this function with the
 * zone it is actually meant to represent instead of the bare `Date`
 * constructor.
 */
export function parseLocalDateTime(dateTimeStr: string, timeZone: string): Date {
  const parsed = DateTime.fromISO(dateTimeStr, { zone: timeZone });
  return parsed.toJSDate();
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
 *
 * Floored to a whole minute (`Math.floor`), not rounded and not fractional:
 * `Availability.startMinutes`/`endMinutes` are `Int` columns, and a shift
 * starting at 09:00:30 is *within* a window that starts at 09:00, not
 * excluded from it by a few stray seconds pushing the value past the
 * integer boundary. Flooring (rather than rounding) is what makes that
 * true consistently -- 09:00:59 must still floor down into the 09:00
 * minute, not round up into 09:01 and spuriously fall outside a window
 * that ends at 09:01.
 */
export function minutesSinceLocalMidnight(instant: Date, timeZone: string): number {
  const zoned = toZoned(instant, timeZone);
  return Math.floor(zoned.hour * 60 + zoned.minute + zoned.second / 60 + zoned.millisecond / 60000);
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
