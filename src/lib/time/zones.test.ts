import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  toZoned,
  localDateKey,
  minutesSinceLocalMidnight,
  weekBounds,
  addLocalDays,
  parseDateOnly,
  parseLocalDateTime,
} from "./zones";

const NY = "America/New_York";
const LA = "America/Los_Angeles";

// Real 2026 US DST transitions (do not swap for synthetic dates — the
// whole point is exercising the actual offset change):
//   Spring forward: 2026-03-08, 02:00 -> 03:00 local (America/New_York)
//   Fall back:       2026-11-01, 02:00 -> 01:00 local (America/New_York)

describe("toZoned", () => {
  it("returns a Luxon DateTime in the requested zone", () => {
    const instant = new Date("2026-06-15T12:00:00Z");
    const zoned = toZoned(instant, NY);
    expect(zoned).toBeInstanceOf(DateTime);
    expect(zoned.zoneName).toBe(NY);
  });
});

describe("localDateKey", () => {
  it("formats as YYYY-MM-DD in the given zone", () => {
    const instant = new Date("2026-06-15T12:00:00Z");
    expect(localDateKey(instant, NY)).toBe("2026-06-15");
  });

  it("the same UTC instant can yield different dates in different zones", () => {
    // 2026-06-15T02:30:00Z is 2026-06-14 22:30 in New York (still the 14th)
    // but 2026-06-14 19:30 in Los Angeles (also the 14th) -- pick an instant
    // that actually straddles midnight between the two zones instead.
    const instant = new Date("2026-06-15T03:30:00Z"); // 23:30 NY on the 14th, 20:30 LA on the 14th
    // Use an instant just after NY midnight but before LA midnight:
    const straddle = new Date("2026-06-15T05:30:00Z"); // 01:30 NY on the 15th, 22:30 LA on the 14th
    expect(localDateKey(straddle, NY)).toBe("2026-06-15");
    expect(localDateKey(straddle, LA)).toBe("2026-06-14");
    expect(localDateKey(instant, NY)).toBe("2026-06-14");
  });
});

describe("minutesSinceLocalMidnight", () => {
  it("computes minutes from local midnight", () => {
    // 14:45 UTC on a non-DST-adjacent day: NY is UTC-4 (EDT) in June -> 10:45 local
    const instant = new Date("2026-06-15T14:45:00Z");
    expect(minutesSinceLocalMidnight(instant, NY)).toBe(10 * 60 + 45);
  });

  it("the same instant yields different minutes in different zones", () => {
    const instant = new Date("2026-06-15T14:45:00Z");
    const ny = minutesSinceLocalMidnight(instant, NY);
    const la = minutesSinceLocalMidnight(instant, LA);
    expect(ny).not.toBe(la);
    // NY (UTC-4) is 3 hours ahead of LA (UTC-7) in June
    expect(ny - la).toBe(3 * 60);
  });

  it("is correct immediately before the spring-forward transition (still EST, UTC-5)", () => {
    // 2026-03-08T06:30:00Z = 01:30 EST (offset -05:00, before the 2am jump)
    const instant = new Date("2026-03-08T06:30:00Z");
    expect(minutesSinceLocalMidnight(instant, NY)).toBe(1 * 60 + 30);
  });

  it("is correct immediately after the spring-forward transition (now EDT, UTC-4)", () => {
    // 2026-03-08T08:30:00Z = 04:30 EDT (offset -04:00, after the 2am->3am jump).
    // A naive fixed-offset (-05:00) implementation would compute 03:30 (210
    // minutes) here instead of the correct 04:30 (270 minutes).
    const instant = new Date("2026-03-08T08:30:00Z");
    expect(minutesSinceLocalMidnight(instant, NY)).toBe(4 * 60 + 30);
  });

  it("floors to a whole minute for a non-zero-second instant, never returning a fraction", () => {
    // 09:00:30 local must read as *within* the 09:00 minute (i.e. 540),
    // not as some fractional value between 540 and 541 -- Availability
    // start/endMinutes are Int columns, so a shift starting mid-second must
    // still compare equal to a window boundary expressed as a whole minute.
    const instant = new Date("2026-06-15T13:00:30.500Z"); // 09:00:30.5 EDT (UTC-4)
    expect(minutesSinceLocalMidnight(instant, NY)).toBe(9 * 60);
    expect(Number.isInteger(minutesSinceLocalMidnight(instant, NY))).toBe(true);
  });

  it("is correct on both sides of the fall-back transition", () => {
    // 2026-11-01T05:30:00Z = 01:30 EDT (offset -04:00, before 2am local fall-back)
    const beforeFallBack = new Date("2026-11-01T05:30:00Z");
    expect(minutesSinceLocalMidnight(beforeFallBack, NY)).toBe(1 * 60 + 30);

    // 2026-11-01T07:30:00Z = 02:30 EST (offset -05:00, after fall-back; wall
    // clock read 01:00 twice that day, this instant is the second 02:30-equivalent)
    const afterFallBack = new Date("2026-11-01T07:30:00Z");
    expect(minutesSinceLocalMidnight(afterFallBack, NY)).toBe(2 * 60 + 30);
  });
});

describe("weekBounds", () => {
  it("a Wednesday resolves to that week's Monday 00:00 through the following Monday 00:00, local", () => {
    const wed = new Date("2026-06-17T15:00:00Z"); // Wed June 17 2026, 11:00 EDT
    const { start, end } = weekBounds(wed, NY);
    const startZoned = DateTime.fromJSDate(start, { zone: NY });
    const endZoned = DateTime.fromJSDate(end, { zone: NY });
    expect(startZoned.weekday).toBe(1);
    expect(startZoned.hour).toBe(0);
    expect(startZoned.minute).toBe(0);
    expect(startZoned.toISODate()).toBe("2026-06-15");
    expect(endZoned.weekday).toBe(1);
    expect(endZoned.hour).toBe(0);
    expect(endZoned.toISODate()).toBe("2026-06-22");
  });

  it("a Monday resolves to itself", () => {
    const mon = new Date("2026-06-15T15:00:00Z"); // Monday
    const { start } = weekBounds(mon, NY);
    const startZoned = DateTime.fromJSDate(start, { zone: NY });
    expect(startZoned.toISODate()).toBe("2026-06-15");
    expect(startZoned.hour).toBe(0);
  });

  it("a Sunday resolves to the preceding Monday", () => {
    const sun = new Date("2026-06-21T15:00:00Z"); // Sunday
    const { start, end } = weekBounds(sun, NY);
    const startZoned = DateTime.fromJSDate(start, { zone: NY });
    const endZoned = DateTime.fromJSDate(end, { zone: NY });
    expect(startZoned.toISODate()).toBe("2026-06-15");
    expect(endZoned.toISODate()).toBe("2026-06-22");
  });

  it("a week containing the spring-forward transition still spans 7 local calendar days", () => {
    // Wed March 4 2026 falls in the week Mon Mar 2 -> Mon Mar 9, which
    // contains the 2026-03-08 spring-forward transition.
    const wed = new Date("2026-03-04T15:00:00Z");
    const { start, end } = weekBounds(wed, NY);
    const startZoned = DateTime.fromJSDate(start, { zone: NY });
    const endZoned = DateTime.fromJSDate(end, { zone: NY });

    expect(startZoned.toISODate()).toBe("2026-03-02");
    expect(startZoned.hour).toBe(0);
    expect(endZoned.toISODate()).toBe("2026-03-09");
    expect(endZoned.hour).toBe(0);

    // The real elapsed time is only 167 hours (one hour was skipped), proving
    // the boundary was computed via calendar-day arithmetic, not by adding
    // a fixed 7*24h duration (which would land on 01:00 local, not 00:00).
    const elapsedHours = endZoned.diff(startZoned, "hours").hours;
    expect(elapsedHours).toBe(167);

    // But it is still exactly 7 distinct local calendar days, Monday..Sunday.
    expect(Math.ceil(elapsedHours / 24)).toBe(7);
  });

  it("a week containing the fall-back transition still spans 7 local calendar days", () => {
    // Wed Oct 28 2026 falls in the week Mon Oct 26 -> Mon Nov 2, which
    // contains the 2026-11-01 fall-back transition.
    const wed = new Date("2026-10-28T15:00:00Z");
    const { start, end } = weekBounds(wed, NY);
    const startZoned = DateTime.fromJSDate(start, { zone: NY });
    const endZoned = DateTime.fromJSDate(end, { zone: NY });

    expect(startZoned.toISODate()).toBe("2026-10-26");
    expect(startZoned.hour).toBe(0);
    expect(endZoned.toISODate()).toBe("2026-11-02");
    expect(endZoned.hour).toBe(0);

    // 169 real elapsed hours (one extra hour gained), again proving
    // calendar-day arithmetic rather than a fixed 7*24h duration.
    const elapsedHours = endZoned.diff(startZoned, "hours").hours;
    expect(elapsedHours).toBe(169);
  });
});

describe("addLocalDays", () => {
  it("adds calendar days, preserving local wall-clock time on ordinary days", () => {
    const start = new Date("2026-06-15T13:00:00Z"); // Mon 09:00 EDT
    const result = addLocalDays(start, NY, 3);
    const zoned = DateTime.fromJSDate(result, { zone: NY });
    expect(zoned.toISODate()).toBe("2026-06-18");
    expect(zoned.hour).toBe(9);
    expect(zoned.minute).toBe(0);
  });

  it("lands on the same local wall-clock time across the spring-forward transition", () => {
    // Sat Mar 7 2026, 09:00 local (EST, offset -05:00). +2 days crosses the
    // 2026-03-08 spring-forward. A naive fixed-duration add (+48h in ms)
    // would land on 10:00 local (2026-03-09T14:00:00Z), one hour off.
    const start = DateTime.fromObject(
      { year: 2026, month: 3, day: 7, hour: 9, minute: 0 },
      { zone: NY },
    ).toJSDate();
    const result = addLocalDays(start, NY, 2);
    const zoned = DateTime.fromJSDate(result, { zone: NY });
    expect(zoned.toISODate()).toBe("2026-03-09");
    expect(zoned.hour).toBe(9);
    expect(zoned.minute).toBe(0);
    // Confirm this genuinely crossed the transition: real elapsed time is 47h, not 48h.
    const startZoned = DateTime.fromJSDate(start, { zone: NY });
    expect(zoned.diff(startZoned, "hours").hours).toBe(47);
  });

  it("lands on the same local wall-clock time across the fall-back transition", () => {
    // Sat Oct 31 2026, 09:00 local (EDT, offset -04:00). +2 days crosses the
    // 2026-11-01 fall-back. A naive fixed-duration add (+48h in ms) would
    // land on 08:00 local, one hour off.
    const start = DateTime.fromObject(
      { year: 2026, month: 10, day: 31, hour: 9, minute: 0 },
      { zone: NY },
    ).toJSDate();
    const result = addLocalDays(start, NY, 2);
    const zoned = DateTime.fromJSDate(result, { zone: NY });
    expect(zoned.toISODate()).toBe("2026-11-02");
    expect(zoned.hour).toBe(9);
    expect(zoned.minute).toBe(0);
    // Confirm this genuinely crossed the transition: real elapsed time is 49h, not 48h.
    const startZoned = DateTime.fromJSDate(start, { zone: NY });
    expect(zoned.diff(startZoned, "hours").hours).toBe(49);
  });
});

describe("parseDateOnly", () => {
  it("parses a bare date string as noon UTC, ensuring the local date is correct for US zones", () => {
    // Test case: "2026-09-14" parsed as UTC midnight would be 2026-09-13T20:00 EDT (Sep 13, previous day)
    // Parsed as noon UTC should be 2026-09-14T08:00 EDT (Sep 14, same day)
    const date = parseDateOnly("2026-09-14");
    const zonedEastern = toZoned(date, NY);

    // Should be September 14, not 13
    expect(zonedEastern.month).toBe(9);
    expect(zonedEastern.day).toBe(14);
  });

  it("ensures week-boundary calculation is correct for an Eastern location", () => {
    // Sep 14, 2026 is a Monday. The correct week should be Sep 14 (Monday) through Sep 20 (Sunday).
    // With the bug (UTC midnight), the date rolls back to Sep 13 (Sunday), which falls in the previous week.
    const date = parseDateOnly("2026-09-14");
    const { start } = weekBounds(date, NY);
    const startZoned = toZoned(start, NY);

    // Should be the Monday of Sep 14's week
    expect(startZoned.month).toBe(9);
    expect(startZoned.day).toBe(14);
    expect(startZoned.weekday).toBe(1); // 1 = Monday
  });

  it("ensures week-boundary calculation is correct for a Pacific location", () => {
    // Same date, different timezone
    const date = parseDateOnly("2026-09-14");
    const { start } = weekBounds(date, LA);
    const startZoned = toZoned(start, LA);

    // Should be the Monday of Sep 14's week
    expect(startZoned.month).toBe(9);
    expect(startZoned.day).toBe(14);
    expect(startZoned.weekday).toBe(1); // 1 = Monday
  });

  it("handles a date that is not a Sunday/Saturday boundary case", () => {
    // Test with a Tuesday to ensure the fix isn't only correct for Sunday
    const date = parseDateOnly("2026-09-15");
    const zonedEastern = toZoned(date, NY);

    // Should be September 15, not 14
    expect(zonedEastern.month).toBe(9);
    expect(zonedEastern.day).toBe(15);
  });
});

describe("parseLocalDateTime", () => {
  // Regression test for a real, confirmed bug: `createShiftAction` used the
  // bare `new Date(datetimeLocalString)` constructor, which for a
  // date-TIME string with no timezone designator is parsed in the
  // RUNTIME's own local system timezone -- not the location's. Submitting
  // "2027-01-15T09:00" for a shift at Harbor Point (America/New_York)
  // produced a stored startAt of 2027-01-15T06:00:00.000Z, which is 09:00
  // interpreted as UTC+3 (the session's server timezone that day), not
  // 09:00 Eastern. `parseLocalDateTime` must anchor the string to the
  // TIMEZONE PASSED IN, regardless of what zone the process happens to be
  // running in.

  it("parses a datetime-local string as wall-clock time in an Eastern location, in January (EST, UTC-5)", () => {
    // January is standard time in the US (no DST), so America/New_York is
    // EST = UTC-5. 09:00 EST is 5 hours ahead in UTC: 14:00 UTC.
    const result = parseLocalDateTime("2027-01-15T09:00", NY);
    expect(result.toISOString()).toBe("2027-01-15T14:00:00.000Z");
  });

  it("parses a datetime-local string as wall-clock time in a Pacific location, in January (PST, UTC-8)", () => {
    // Proves the fix isn't accidentally Eastern-only: America/Los_Angeles
    // in January is PST = UTC-8. 09:00 PST is 8 hours ahead in UTC: 17:00 UTC.
    const result = parseLocalDateTime("2027-01-15T09:00", LA);
    expect(result.toISOString()).toBe("2027-01-15T17:00:00.000Z");
  });

  it("respects DST: the same wall-clock time in an Eastern location in July (EDT, UTC-4) yields a different UTC instant than in January", () => {
    // Confirms the function reads the real offset for the given date rather
    // than a fixed EST/EDT assumption -- July is daylight time, EDT = UTC-4.
    // 09:00 EDT is 13:00 UTC, not 14:00 UTC as it would be under EST.
    const result = parseLocalDateTime("2027-07-15T09:00", NY);
    expect(result.toISOString()).toBe("2027-07-15T13:00:00.000Z");
  });
});
