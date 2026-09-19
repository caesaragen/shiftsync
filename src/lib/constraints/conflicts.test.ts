import { describe, it, expect } from "vitest";
import type { EngineContext } from "./types";
import { checkConflicts } from "./conflicts";

const NY = "America/New_York";
const LA = "America/Los_Angeles";

function existingShift(overrides: Partial<EngineContext["existingAssignments"][0]> = {}) {
  return {
    shiftId: "shift-existing-1",
    locationId: "loc-pier39",
    locationName: "Pier 39",
    locationTimezone: NY,
    startAt: new Date("2026-06-15T14:00:00Z"),
    endAt: new Date("2026-06-15T18:00:00Z"),
    ...overrides,
  };
}

function baseCtx(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    staff: { id: "staff-1", name: "Jordan", homeTimezone: NY },
    shift: {
      id: "shift-1",
      locationId: "loc-pier39",
      locationName: "Pier 39",
      locationTimezone: NY,
      startAt: new Date("2026-06-15T14:00:00Z"), // 10:00 AM EDT
      endAt: new Date("2026-06-15T18:00:00Z"), // 2:00 PM EDT
      requiredSkillId: "skill-bartender",
      requiredSkillName: "bartender",
    },
    skills: [{ id: "skill-bartender", name: "bartender" }],
    activeCertificationLocationIds: ["loc-pier39"],
    availability: [],
    existingAssignments: [],
    ...overrides,
  };
}

describe("checkConflicts", () => {
  it("emits no violations when there are no existing assignments", () => {
    const ctx = baseCtx();
    expect(checkConflicts(ctx)).toEqual([]);
  });

  describe("DOUBLE_BOOKING", () => {
    it("detects an exact overlap with an existing shift", () => {
      const ctx = baseCtx({
        existingAssignments: [existingShift()],
      });
      const violations = checkConflicts(ctx);
      const v = violations.find((x) => x.rule === "DOUBLE_BOOKING");
      expect(v).toBeDefined();
      expect(v?.severity).toBe("BLOCK");
    });

    it("detects a partial overlap (candidate starts before, ends in the middle)", () => {
      const ctx = baseCtx({
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T15:00:00Z"), // starts 1 hour into candidate
            endAt: new Date("2026-06-15T19:00:00Z"),
          }),
        ],
      });
      const violations = checkConflicts(ctx);
      const v = violations.find((x) => x.rule === "DOUBLE_BOOKING");
      expect(v).toBeDefined();
      expect(v?.severity).toBe("BLOCK");
    });

    it("detects a partial overlap (candidate starts in the middle, ends after)", () => {
      const ctx = baseCtx({
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T13:00:00Z"), // starts 1 hour before candidate
            endAt: new Date("2026-06-15T15:30:00Z"), // ends in the middle
          }),
        ],
      });
      const violations = checkConflicts(ctx);
      const v = violations.find((x) => x.rule === "DOUBLE_BOOKING");
      expect(v).toBeDefined();
      expect(v?.severity).toBe("BLOCK");
    });

    it("detects when the candidate shift fully contains an existing shift", () => {
      const ctx = baseCtx({
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-15T12:00:00Z"),
          endAt: new Date("2026-06-15T20:00:00Z"),
        },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T18:00:00Z"),
          }),
        ],
      });
      const violations = checkConflicts(ctx);
      const v = violations.find((x) => x.rule === "DOUBLE_BOOKING");
      expect(v).toBeDefined();
      expect(v?.severity).toBe("BLOCK");
    });

    it("detects when an existing shift fully contains the candidate", () => {
      const ctx = baseCtx({
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T12:00:00Z"),
            endAt: new Date("2026-06-15T20:00:00Z"),
          }),
        ],
      });
      const violations = checkConflicts(ctx);
      const v = violations.find((x) => x.rule === "DOUBLE_BOOKING");
      expect(v).toBeDefined();
      expect(v?.severity).toBe("BLOCK");
    });

    it("detects a conflict with a shift at a DIFFERENT location (a person can't be in two places at once)", () => {
      const ctx = baseCtx({
        existingAssignments: [
          existingShift({
            locationId: "loc-harbor-point",
            locationName: "Harbor Point",
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T18:00:00Z"),
          }),
        ],
      });
      const violations = checkConflicts(ctx);
      const v = violations.find((x) => x.rule === "DOUBLE_BOOKING");
      expect(v).toBeDefined();
      expect(v?.severity).toBe("BLOCK");
    });

    it("DOUBLE_BOOKING message names the staff member, the conflicting location, and the conflicting shift's times", () => {
      const ctx = baseCtx({
        existingAssignments: [
          existingShift({
            locationId: "loc-harbor-point",
            locationName: "Harbor Point",
            startAt: new Date("2026-06-15T16:00:00Z"), // 12:00 PM EDT
            endAt: new Date("2026-06-15T20:00:00Z"), // 4:00 PM EDT
          }),
        ],
      });
      const violations = checkConflicts(ctx);
      const v = violations.find((x) => x.rule === "DOUBLE_BOOKING");
      expect(v?.message).toContain("Jordan");
      expect(v?.message).toContain("Harbor Point");
      expect(v?.message).toMatch(/12:00 PM.*4:00 PM/);
    });

    it("back-to-back shifts (one ends exactly when the next starts) do NOT overlap", () => {
      const ctx = baseCtx({
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-15T18:00:00Z"), // candidate starts exactly when existing ends
          endAt: new Date("2026-06-15T22:00:00Z"),
        },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T18:00:00Z"),
          }),
        ],
      });
      const violations = checkConflicts(ctx);
      const doubleBooking = violations.find((x) => x.rule === "DOUBLE_BOOKING");
      expect(doubleBooking).toBeUndefined(); // no overlap = no double-booking
    });

    it("no violation when there's a gap between shifts", () => {
      const ctx = baseCtx({
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-15T20:00:00Z"), // 4 hours after existing ends
          endAt: new Date("2026-06-16T00:00:00Z"),
        },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T18:00:00Z"),
          }),
        ],
      });
      const violations = checkConflicts(ctx);
      const doubleBooking = violations.find((x) => x.rule === "DOUBLE_BOOKING");
      expect(doubleBooking).toBeUndefined();
    });

    it("cross-timezone conflict: detects overlap between Eastern and Pacific shifts, showing each in its own timezone", () => {
      // Candidate: 2:00 PM–6:00 PM EDT at Pier 39 (Eastern)
      // Existing: 11:00 AM–3:00 PM PDT at Sunset Grill (Pacific, same absolute times)
      const ctx = baseCtx({
        shift: {
          id: "shift-eastern",
          locationId: "loc-pier39",
          locationName: "Pier 39",
          locationTimezone: NY,
          startAt: new Date("2026-06-15T18:00:00Z"), // 2:00 PM EDT
          endAt: new Date("2026-06-15T22:00:00Z"), // 6:00 PM EDT
          requiredSkillId: "skill-bartender",
          requiredSkillName: "bartender",
        },
        existingAssignments: [
          existingShift({
            shiftId: "shift-pacific",
            locationId: "loc-sunset-grill",
            locationName: "Sunset Grill",
            locationTimezone: LA,
            startAt: new Date("2026-06-15T18:00:00Z"), // 11:00 AM PDT (same UTC as 2:00 PM EDT)
            endAt: new Date("2026-06-15T22:00:00Z"), // 3:00 PM PDT (same UTC as 6:00 PM EDT)
          }),
        ],
      });
      const violations = checkConflicts(ctx);
      const v = violations.find((x) => x.rule === "DOUBLE_BOOKING");
      expect(v).toBeDefined();
      expect(v?.severity).toBe("BLOCK");
      // Message should show existing shift in Pacific time and candidate in Eastern time
      expect(v?.message).toContain("Sunset Grill");
      expect(v?.message).toContain("Pier 39");
      expect(v?.message).toContain("11:00 AM"); // existing shift in PDT
      expect(v?.message).toContain("3:00 PM"); // existing shift end in PDT
      expect(v?.message).toContain("2:00 PM"); // candidate in EDT
      expect(v?.message).toContain("6:00 PM"); // candidate in EDT
    });
  });

  describe("REST_GAP", () => {
    it("detects a rest gap violation when there are fewer than 10 hours between shifts (candidate after existing)", () => {
      const ctx = baseCtx({
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-15T22:00:00Z"), // 4 hours after existing ends (18:00)
          endAt: new Date("2026-06-16T02:00:00Z"),
        },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T18:00:00Z"),
          }),
        ],
      });
      const violations = checkConflicts(ctx);
      const v = violations.find((x) => x.rule === "REST_GAP");
      expect(v).toBeDefined();
      expect(v?.severity).toBe("BLOCK");
    });

    it("detects a rest gap violation when there are fewer than 10 hours between shifts (candidate before existing)", () => {
      const ctx = baseCtx({
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-15T08:00:00Z"), // ends 6 hours before existing starts
          endAt: new Date("2026-06-15T12:00:00Z"),
        },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T18:00:00Z"),
            endAt: new Date("2026-06-15T22:00:00Z"),
          }),
        ],
      });
      const violations = checkConflicts(ctx);
      const v = violations.find((x) => x.rule === "REST_GAP");
      expect(v).toBeDefined();
      expect(v?.severity).toBe("BLOCK");
    });

    it("allows exactly 10 hours between the end of one shift and the start of another (candidate after existing)", () => {
      const ctx = baseCtx({
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-16T04:00:00Z"), // exactly 10 hours after existing ends
          endAt: new Date("2026-06-16T08:00:00Z"),
        },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T18:00:00Z"),
          }),
        ],
      });
      const violations = checkConflicts(ctx);
      const v = violations.find((x) => x.rule === "REST_GAP");
      expect(v).toBeUndefined();
    });

    it("allows exactly 10 hours between the end of one shift and the start of another (candidate before existing)", () => {
      const ctx = baseCtx({
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-15T00:00:00Z"),
          endAt: new Date("2026-06-15T04:00:00Z"),
        },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T18:00:00Z"),
          }),
        ],
      });
      const violations = checkConflicts(ctx);
      const v = violations.find((x) => x.rule === "REST_GAP");
      expect(v).toBeUndefined();
    });

    it("blocks 9h59m between shifts (candidate after existing)", () => {
      const existingEnd = new Date("2026-06-15T18:00:00Z");
      const candidateStart = new Date(existingEnd.getTime() + 9 * 60 * 60 * 1000 + 59 * 60 * 1000); // 9h59m later

      const ctx = baseCtx({
        shift: {
          ...baseCtx().shift,
          startAt: candidateStart,
          endAt: new Date(candidateStart.getTime() + 4 * 60 * 60 * 1000),
        },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: existingEnd,
          }),
        ],
      });
      const violations = checkConflicts(ctx);
      const v = violations.find((x) => x.rule === "REST_GAP");
      expect(v).toBeDefined();
      expect(v?.severity).toBe("BLOCK");
    });

    it("blocks 9h59m between shifts (candidate before existing)", () => {
      const existingStart = new Date("2026-06-15T14:00:00Z");
      const candidateEnd = new Date(existingStart.getTime() - 9 * 60 * 60 * 1000 - 59 * 60 * 1000);

      const ctx = baseCtx({
        shift: {
          ...baseCtx().shift,
          startAt: new Date(candidateEnd.getTime() - 4 * 60 * 60 * 1000),
          endAt: candidateEnd,
        },
        existingAssignments: [
          existingShift({
            startAt: existingStart,
            endAt: new Date("2026-06-15T18:00:00Z"),
          }),
        ],
      });
      const violations = checkConflicts(ctx);
      const v = violations.find((x) => x.rule === "REST_GAP");
      expect(v).toBeDefined();
      expect(v?.severity).toBe("BLOCK");
    });

    it("back-to-back shifts (one ends exactly when the next starts) violate the rest gap", () => {
      const ctx = baseCtx({
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-15T18:00:00Z"), // candidate starts exactly when existing ends
          endAt: new Date("2026-06-15T22:00:00Z"),
        },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T18:00:00Z"),
          }),
        ],
      });
      const violations = checkConflicts(ctx);
      const v = violations.find((x) => x.rule === "REST_GAP");
      expect(v).toBeDefined();
      expect(v?.severity).toBe("BLOCK");
      // Should state it's 0 hours gap
      expect(v?.message).toMatch(/0\s+hours?/i);
    });

    it("REST_GAP message states the actual gap between shifts", () => {
      const ctx = baseCtx({
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-15T21:30:00Z"), // 3.5 hours after existing ends
          endAt: new Date("2026-06-16T01:30:00Z"),
        },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T18:00:00Z"),
          }),
        ],
      });
      const violations = checkConflicts(ctx);
      const v = violations.find((x) => x.rule === "REST_GAP");
      expect(v?.message).toContain("3");
      expect(v?.message).toContain("30");
    });

    it("handles overnight shifts correctly (23:00 one day -> 03:00 the next)", () => {
      const ctx = baseCtx({
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-15T03:00:00Z"), // 11 PM UTC prev day = 7 PM EDT same day
          endAt: new Date("2026-06-15T07:00:00Z"), // 3 AM UTC next day = 11 PM EDT same day
        },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T12:00:00Z"), // 8 AM UTC = 4 AM EDT
            endAt: new Date("2026-06-15T16:00:00Z"), // noon UTC = 8 AM EDT
          }),
        ],
      });
      const violations = checkConflicts(ctx);
      // This is 4 hours between 11 PM and 8 AM next day, which should trigger REST_GAP
      const v = violations.find((x) => x.rule === "REST_GAP");
      expect(v).toBeDefined();
    });
  });

  describe("Multiple violations", () => {
    it("returns ALL applicable violations, never short-circuiting", () => {
      // Create a scenario where both rules are violated
      const ctx = baseCtx({
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-15T17:00:00Z"), // partially overlaps and is within rest-gap range
          endAt: new Date("2026-06-15T19:00:00Z"),
        },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T18:00:00Z"),
          }),
        ],
      });
      const violations = checkConflicts(ctx);
      const rules = violations.map((v) => v.rule).sort();
      // Only DOUBLE_BOOKING should fire, not REST_GAP (because overlapping cancels the gap check)
      expect(rules).toEqual(["DOUBLE_BOOKING"]);
    });

    it("both DOUBLE_BOOKING and REST_GAP can fire for different existing assignments", () => {
      const ctx = baseCtx({
        existingAssignments: [
          existingShift({
            shiftId: "shift-1",
            startAt: new Date("2026-06-15T17:00:00Z"), // overlaps with candidate
            endAt: new Date("2026-06-15T19:00:00Z"),
          }),
          existingShift({
            shiftId: "shift-2",
            locationId: "loc-harbor-point",
            locationName: "Harbor Point",
            startAt: new Date("2026-06-16T00:00:00Z"), // too close (4 hours later)
            endAt: new Date("2026-06-16T04:00:00Z"),
          }),
        ],
      });
      const violations = checkConflicts(ctx);
      const rules = violations.map((v) => v.rule).sort();
      expect(rules).toEqual(["DOUBLE_BOOKING", "REST_GAP"]);
      expect(violations).toHaveLength(2);
    });
  });
});
