import { toZoned } from "./zones";

const MINUTES_PER_DAY = 1440;

/**
 * Format a minutes-since-local-midnight value as a 12-hour clock string,
 * e.g. 570 -> "9:30 AM". Wraps modulo 1440 first, so values beyond a single
 * day (used elsewhere to represent a time on the following day, e.g. an
 * overnight availability window) still format as an ordinary clock time.
 */
export function formatClockMinutes(minutesOfDay: number): string {
  const norm = ((minutesOfDay % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour24 = Math.floor(norm / 60);
  const minute = norm % 60;
  const period = hour24 < 12 ? "AM" : "PM";
  const hour12raw = hour24 % 12;
  const hour12 = hour12raw === 0 ? 12 : hour12raw;
  return `${hour12}:${minute.toString().padStart(2, "0")} ${period}`;
}

/** The 12-hour clock time `instant` reads as in `timeZone`, e.g. "9:00 AM". */
export function formatInstantClock(instant: Date, timeZone: string): string {
  const zoned = toZoned(instant, timeZone);
  return formatClockMinutes(zoned.hour * 60 + zoned.minute);
}

/**
 * A short zone abbreviation for `instant` in `timeZone` (e.g. "EDT" or
 * "PDT"). Deliberately derived LIVE from the actual UTC offset at that
 * instant via Luxon/Intl, never a hardcoded "EDT"/"PDT" string literal --
 * that is what keeps it correct on both sides of a DST transition.
 */
export function zoneAbbrev(instant: Date, timeZone: string): string {
  return toZoned(instant, timeZone).offsetNameShort ?? timeZone;
}
