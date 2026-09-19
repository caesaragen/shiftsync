import { describe, it, expect } from "vitest";
import { overlaps, gapMinutes, durationHours, type Interval } from "./intervals";

function iv(startIso: string, endIso: string): Interval {
  return { start: new Date(startIso), end: new Date(endIso) };
}

describe("overlaps", () => {
  it("returns true for identical intervals", () => {
    const a = iv("2026-01-01T10:00:00Z", "2026-01-01T12:00:00Z");
    const b = iv("2026-01-01T10:00:00Z", "2026-01-01T12:00:00Z");
    expect(overlaps(a, b)).toBe(true);
  });

  it("returns true for a partial overlap", () => {
    const a = iv("2026-01-01T10:00:00Z", "2026-01-01T12:00:00Z");
    const b = iv("2026-01-01T11:00:00Z", "2026-01-01T13:00:00Z");
    expect(overlaps(a, b)).toBe(true);
    expect(overlaps(b, a)).toBe(true);
  });

  it("returns true when one interval contains another", () => {
    const outer = iv("2026-01-01T09:00:00Z", "2026-01-01T17:00:00Z");
    const inner = iv("2026-01-01T11:00:00Z", "2026-01-01T13:00:00Z");
    expect(overlaps(outer, inner)).toBe(true);
    expect(overlaps(inner, outer)).toBe(true);
  });

  it("returns FALSE for abutting intervals (a.end === b.start) -- back-to-back is legal", () => {
    const first = iv("2026-01-01T09:00:00Z", "2026-01-01T17:00:00Z");
    const second = iv("2026-01-01T17:00:00Z", "2026-01-01T21:00:00Z");
    expect(overlaps(first, second)).toBe(false);
    expect(overlaps(second, first)).toBe(false);
  });

  it("returns false for intervals with a gap between them", () => {
    const a = iv("2026-01-01T09:00:00Z", "2026-01-01T10:00:00Z");
    const b = iv("2026-01-01T12:00:00Z", "2026-01-01T13:00:00Z");
    expect(overlaps(a, b)).toBe(false);
  });
});

describe("gapMinutes", () => {
  it("is exactly 600 for a 10-hour gap", () => {
    const a = iv("2026-01-01T09:00:00Z", "2026-01-01T10:00:00Z");
    const b = iv("2026-01-01T20:00:00Z", "2026-01-01T21:00:00Z");
    expect(gapMinutes(a, b)).toBe(600);
  });

  it("is exactly 599 for a 9h59m gap", () => {
    const a = iv("2026-01-01T09:00:00Z", "2026-01-01T10:00:00Z");
    const b = iv("2026-01-01T19:59:00Z", "2026-01-01T21:00:00Z");
    expect(gapMinutes(a, b)).toBe(599);
  });

  it("is 0 when the intervals overlap", () => {
    const a = iv("2026-01-01T09:00:00Z", "2026-01-01T12:00:00Z");
    const b = iv("2026-01-01T11:00:00Z", "2026-01-01T13:00:00Z");
    expect(gapMinutes(a, b)).toBe(0);
  });

  it("is 0 for abutting intervals", () => {
    const a = iv("2026-01-01T09:00:00Z", "2026-01-01T17:00:00Z");
    const b = iv("2026-01-01T17:00:00Z", "2026-01-01T21:00:00Z");
    expect(gapMinutes(a, b)).toBe(0);
  });

  it("is order-independent", () => {
    const a = iv("2026-01-01T09:00:00Z", "2026-01-01T10:00:00Z");
    const b = iv("2026-01-01T20:00:00Z", "2026-01-01T21:00:00Z");
    expect(gapMinutes(a, b)).toBe(gapMinutes(b, a));
    expect(gapMinutes(a, b)).toBe(600);
  });
});

describe("durationHours", () => {
  it("computes a simple 4-hour shift", () => {
    const shift = iv("2026-01-01T09:00:00Z", "2026-01-01T13:00:00Z");
    expect(durationHours(shift)).toBe(4);
  });

  it("computes an overnight 23:00 -> 03:00 shift as 4 hours, not -20", () => {
    const overnight = iv("2026-01-01T23:00:00-05:00", "2026-01-02T03:00:00-05:00");
    expect(durationHours(overnight)).toBe(4);
  });
});
