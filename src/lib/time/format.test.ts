import { describe, it, expect } from "vitest";
import { formatClockMinutes, formatInstantClock, zoneAbbrev } from "./format";

const NY = "America/New_York";
const LA = "America/Los_Angeles";

describe("formatClockMinutes", () => {
  it("formats morning, noon, afternoon and midnight correctly", () => {
    expect(formatClockMinutes(0)).toBe("12:00 AM");
    expect(formatClockMinutes(9 * 60)).toBe("9:00 AM");
    expect(formatClockMinutes(12 * 60)).toBe("12:00 PM");
    expect(formatClockMinutes(20 * 60)).toBe("8:00 PM");
    expect(formatClockMinutes(23 * 60 + 59)).toBe("11:59 PM");
  });

  it("wraps values beyond 1440 (a following-day time) as an ordinary clock time", () => {
    // 26:00 (overnight window notation) -> 02:00 AM
    expect(formatClockMinutes(26 * 60)).toBe("2:00 AM");
  });
});

describe("formatInstantClock", () => {
  it("reads the wall-clock time an instant falls on in a given zone", () => {
    // 2026-06-15T16:00:00Z is 12:00 PM EDT (-4) and 09:00 AM PDT (-7)
    const instant = new Date("2026-06-15T16:00:00Z");
    expect(formatInstantClock(instant, NY)).toBe("12:00 PM");
    expect(formatInstantClock(instant, LA)).toBe("9:00 AM");
  });
});

describe("zoneAbbrev", () => {
  it("derives the correct abbreviation live, on both sides of a DST transition", () => {
    // Before spring-forward (still EST, UTC-5): 2026-03-08T06:30:00Z = 01:30 EST
    const beforeTransition = new Date("2026-03-08T06:30:00Z");
    expect(zoneAbbrev(beforeTransition, NY)).toBe("EST");
    // After spring-forward (now EDT, UTC-4): 2026-03-08T08:30:00Z = 04:30 EDT
    const afterTransition = new Date("2026-03-08T08:30:00Z");
    expect(zoneAbbrev(afterTransition, NY)).toBe("EDT");
  });

  it("gives the Pacific abbreviation for a Pacific instant", () => {
    const instant = new Date("2026-06-15T16:00:00Z");
    expect(zoneAbbrev(instant, LA)).toBe("PDT");
  });
});
