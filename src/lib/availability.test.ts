import { describe, it, expect } from "vitest";
import type { Availability } from "@prisma/client";
import { isStaffAvailable } from "./availability";

const NY = "America/New_York";
const LA = "America/Los_Angeles";

let seq = 0;

/** Build an Availability row with sane defaults, overridable per-test. */
function row(overrides: Partial<Availability> & Pick<Availability, "kind">): Availability {
  seq += 1;
  const defaults: Availability = {
    id: `avail-${seq}`,
    staffId: "staff-1",
    kind: overrides.kind,
    dayOfWeek: null,
    date: null,
    startMinutes: 0,
    endMinutes: 0,
    isAvailable: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
  return { ...defaults, ...overrides };
}

function shift(startIso: string, endIso: string) {
  return { startAt: new Date(startIso), endAt: new Date(endIso) };
}

describe("isStaffAvailable", () => {
  it("is available when the shift is fully inside a recurring window", () => {
    // Mon 2026-06-15 in NY; dayOfWeek 1 = Monday
    const rows = [
      row({ kind: "RECURRING", dayOfWeek: 1, startMinutes: 9 * 60, endMinutes: 17 * 60 }),
    ];
    const s = shift("2026-06-15T14:00:00Z", "2026-06-15T18:00:00Z"); // 10:00-14:00 EDT
    const result = isStaffAvailable(rows, s, NY);
    expect(result.available).toBe(true);
  });

  it("is unavailable when the shift starts before the window opens", () => {
    const rows = [
      row({ kind: "RECURRING", dayOfWeek: 1, startMinutes: 9 * 60, endMinutes: 17 * 60 }),
    ];
    // 08:00-12:00 EDT -- starts an hour before the 09:00 window opens
    const s = shift("2026-06-15T12:00:00Z", "2026-06-15T16:00:00Z");
    const result = isStaffAvailable(rows, s, NY);
    expect(result.available).toBe(false);
  });

  it("is unavailable when the shift ends after the window closes", () => {
    const rows = [
      row({ kind: "RECURRING", dayOfWeek: 1, startMinutes: 9 * 60, endMinutes: 17 * 60 }),
    ];
    // 16:00-22:00 EDT -- starts inside the window but runs 5 hours past close
    const s = shift("2026-06-15T20:00:00Z", "2026-06-16T02:00:00Z");
    const result = isStaffAvailable(rows, s, NY);
    expect(result.available).toBe(false);
  });

  it("is available when the shift exactly matches the window's bounds", () => {
    const rows = [
      row({ kind: "RECURRING", dayOfWeek: 1, startMinutes: 9 * 60, endMinutes: 17 * 60 }),
    ];
    const s = shift("2026-06-15T13:00:00Z", "2026-06-15T21:00:00Z"); // 09:00-17:00 EDT exactly
    const result = isStaffAvailable(rows, s, NY);
    expect(result.available).toBe(true);
  });

  it("an EXCEPTION grants availability on a day with no recurring window", () => {
    const rows = [
      row({
        kind: "EXCEPTION",
        date: new Date("2026-06-15T00:00:00Z"),
        startMinutes: 9 * 60,
        endMinutes: 17 * 60,
        isAvailable: true,
      }),
    ];
    const s = shift("2026-06-15T14:00:00Z", "2026-06-15T18:00:00Z"); // 10:00-14:00 EDT
    const result = isStaffAvailable(rows, s, NY);
    expect(result.available).toBe(true);
  });

  it("an EXCEPTION denies availability on a day that otherwise has a recurring window covering the shift", () => {
    const rows = [
      row({ kind: "RECURRING", dayOfWeek: 1, startMinutes: 9 * 60, endMinutes: 17 * 60 }),
      row({
        kind: "EXCEPTION",
        date: new Date("2026-06-15T00:00:00Z"),
        startMinutes: 9 * 60,
        endMinutes: 17 * 60,
        isAvailable: false,
      }),
    ];
    const s = shift("2026-06-15T14:00:00Z", "2026-06-15T18:00:00Z"); // 10:00-14:00 EDT, Monday
    const result = isStaffAvailable(rows, s, NY);
    expect(result.available).toBe(false);
  });

  it("an EXCEPTION for a different date does not affect the recurring window", () => {
    const rows = [
      row({ kind: "RECURRING", dayOfWeek: 1, startMinutes: 9 * 60, endMinutes: 17 * 60 }),
      row({
        kind: "EXCEPTION",
        date: new Date("2026-06-22T00:00:00Z"), // next Monday, not this one
        startMinutes: 9 * 60,
        endMinutes: 17 * 60,
        isAvailable: false,
      }),
    ];
    const s = shift("2026-06-15T14:00:00Z", "2026-06-15T18:00:00Z"); // 10:00-14:00 EDT
    const result = isStaffAvailable(rows, s, NY);
    expect(result.available).toBe(true);
  });

  it("an overnight shift is checked against a window crossing midnight (endMinutes > 1440)", () => {
    // Window 22:00 Mon -> 02:00 Tue, expressed as dayOfWeek=1 (Monday), endMinutes 1560 (26:00)
    const rows = [
      row({ kind: "RECURRING", dayOfWeek: 1, startMinutes: 22 * 60, endMinutes: 26 * 60 }),
    ];
    // Shift 23:00 Mon -> 01:00 Tue, EDT
    const s = shift("2026-06-16T03:00:00Z", "2026-06-16T05:00:00Z"); // 23:00 Mon EDT -> 01:00 Tue EDT
    const result = isStaffAvailable(rows, s, NY);
    expect(result.available).toBe(true);
  });

  it("an overnight shift fails when Tuesday has no window continuing the Monday-night coverage", () => {
    const rows = [
      row({ kind: "RECURRING", dayOfWeek: 1, startMinutes: 22 * 60, endMinutes: 24 * 60 }),
    ]; // only until midnight
    const s = shift("2026-06-16T03:00:00Z", "2026-06-16T05:00:00Z"); // 23:00 Mon EDT -> 01:00 Tue EDT
    const result = isStaffAvailable(rows, s, NY);
    expect(result.available).toBe(false);
  });

  it("fails closed: no matching window at all means unavailable", () => {
    const rows: Availability[] = [];
    const s = shift("2026-06-15T14:00:00Z", "2026-06-15T18:00:00Z");
    const result = isStaffAvailable(rows, s, NY);
    expect(result.available).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("Timezone Tangle: NY staff with a 09:00-17:00 local window is UNAVAILABLE for a shift that is 09:00-17:00 at a Pacific location (12:00-20:00 Eastern), with an intelligible reason", () => {
    const rows = [
      row({ kind: "RECURRING", dayOfWeek: 1, startMinutes: 9 * 60, endMinutes: 17 * 60 }),
    ];
    // 09:00-17:00 Pacific on Monday 2026-06-15 == 12:00-20:00 Eastern
    const s = shift("2026-06-15T16:00:00Z", "2026-06-16T00:00:00Z");
    // sanity: this really is 09:00-17:00 in LA
    const laStart = new Date("2026-06-15T16:00:00Z");
    const laEnd = new Date("2026-06-16T00:00:00Z");
    expect(
      new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: LA }).format(
        laStart,
      ),
    ).toMatch(/^0?9$/);
    expect(
      new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: LA }).format(
        laEnd,
      ),
    ).toMatch(/^(17|5)$/);

    const result = isStaffAvailable(rows, s, NY);
    expect(result.available).toBe(false);
    expect(result.reason).toBeTruthy();
    // The message must be intelligible: it should surface both the staff's
    // available window and the shift's actual (converted) local times, not
    // a bare "not available".
    expect(result.reason).toMatch(/9:00\s*AM/i);
    expect(result.reason).toMatch(/5:00\s*PM/i);
    expect(result.reason).toMatch(/12:00\s*PM/i);
    expect(result.reason).toMatch(/8:00\s*PM/i);
  });
});
