/**
 * Pure interval math over absolute instants (`Date`). Intervals are
 * half-open [start, end): two intervals that merely touch at a shared edge
 * (one's `end` equals the other's `start`) do NOT overlap -- that is a
 * legal back-to-back arrangement (e.g. a shift ending 17:00 followed by one
 * starting 17:00), not a double-booking.
 */
export type Interval = { start: Date; end: Date };

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/**
 * Minutes between the nearest edges of two non-overlapping intervals, or 0
 * if they overlap (or merely touch). Order-independent: `gapMinutes(a, b)`
 * equals `gapMinutes(b, a)`.
 */
export function gapMinutes(a: Interval, b: Interval): number {
  const aStart = a.start.getTime();
  const aEnd = a.end.getTime();
  const bStart = b.start.getTime();
  const bEnd = b.end.getTime();

  if (overlaps(a, b)) return 0;

  const gapMs = aEnd <= bStart ? bStart - aEnd : aStart - bEnd;
  return gapMs / 60000;
}

/**
 * Duration of an interval in hours, computed from the absolute instants --
 * so an overnight shift (e.g. 23:00 one day -> 03:00 the next) correctly
 * yields 4, never -20 (which a naive "hour - hour" computation would give).
 */
export function durationHours(i: Interval): number {
  return (i.end.getTime() - i.start.getTime()) / (1000 * 60 * 60);
}
