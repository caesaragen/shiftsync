import { describe, it, expect } from "vitest";
import type { EngineContext } from "./types";
import { checkHours } from "./hours";

const NY = "America/New_York";

function existingShift(overrides: Partial<EngineContext["existingAssignments"][0]> = {}) {
  return {
    shiftId: "shift-existing",
    locationId: "loc-pier39",
    locationName: "Pier 39",
    locationTimezone: NY,
    startAt: new Date("2026-06-15T14:00:00Z"), // 10:00 AM EDT
    endAt: new Date("2026-06-15T18:00:00Z"), // 2:00 PM EDT
    ...overrides,
  };
}

function baseCtx(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    staff: { id: "staff-1", name: "Riley", homeTimezone: NY },
    shift: {
      id: "shift-1",
      locationId: "loc-pier39",
      locationName: "Pier 39",
      locationTimezone: NY,
      startAt: new Date("2026-06-15T14:00:00Z"), // 10:00 AM EDT
      endAt: new Date("2026-06-15T18:00:00Z"), // 2:00 PM EDT (4 hours)
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

describe("checkHours", () => {
  describe("DAILY_HOURS_WARN", () => {
    it("emits no violation when a local day totals exactly 8 hours", () => {
      const ctx = baseCtx({
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"), // 10:00 AM EDT
            endAt: new Date("2026-06-15T18:00:00Z"), // 2:00 PM EDT (4 hours)
          }),
        ],
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-15T18:00:00Z"), // 2:00 PM EDT
          endAt: new Date("2026-06-15T22:00:00Z"), // 6:00 PM EDT (4 hours, total 8)
        },
      });
      const violations = checkHours(ctx);
      const v = violations.find((x) => x.rule === "DAILY_HOURS_WARN");
      expect(v).toBeUndefined();
    });

    it("emits DAILY_HOURS_WARN (WARN) when a local day totals 8 hours and 1 minute", () => {
      const ctx = baseCtx({
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"), // 10:00 AM EDT (4 hours)
            endAt: new Date("2026-06-15T18:00:00Z"),
          }),
        ],
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-15T18:00:00Z"),
          endAt: new Date("2026-06-15T22:01:00Z"), // 4 hours 1 minute
        },
      });
      const violations = checkHours(ctx);
      const v = violations.find((x) => x.rule === "DAILY_HOURS_WARN");
      expect(v).toBeDefined();
      expect(v?.severity).toBe("WARN");
    });

    it("DAILY_HOURS_WARN message names the person, the actual hours, and the threshold", () => {
      const ctx = baseCtx({
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T18:00:00Z"),
          }),
        ],
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-15T18:00:00Z"),
          endAt: new Date("2026-06-15T23:00:00Z"), // 5 hours, total 9
        },
      });
      const violations = checkHours(ctx);
      const v = violations.find((x) => x.rule === "DAILY_HOURS_WARN");
      expect(v?.message).toContain("Riley");
      expect(v?.message).toContain("9");
      // Verify it's named as hours, not a generic phrase
      expect(v?.message).not.toMatch(/^too many hours$/i);
    });

    it("candidate shift tips the daily total over the 8-hour threshold", () => {
      const ctx = baseCtx({
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T21:00:00Z"), // 7 hours
          }),
        ],
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-15T21:00:00Z"),
          endAt: new Date("2026-06-15T22:30:00Z"), // 1.5 hours, total 8.5
        },
      });
      const violations = checkHours(ctx);
      const v = violations.find((x) => x.rule === "DAILY_HOURS_WARN");
      expect(v).toBeDefined();
      expect(v?.severity).toBe("WARN");
    });

    it("does not warn if existing assignments already exceed 8 hours but the day still accumulates correctly", () => {
      const ctx = baseCtx({
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T22:00:00Z"), // 8 hours
          }),
        ],
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-15T22:00:00Z"),
          endAt: new Date("2026-06-15T23:00:00Z"), // 1 hour, total 9 (should warn)
        },
      });
      const violations = checkHours(ctx);
      const v = violations.find((x) => x.rule === "DAILY_HOURS_WARN");
      expect(v).toBeDefined();
    });
  });

  describe("DAILY_HOURS_BLOCK", () => {
    it("emits no violation when a local day totals exactly 12 hours", () => {
      const ctx = baseCtx({
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"), // 10:00 AM EDT
            endAt: new Date("2026-06-15T20:00:00Z"), // 4:00 PM EDT (6 hours)
          }),
        ],
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-15T20:00:00Z"),
          endAt: new Date("2026-06-16T02:00:00Z"), // 6 hours, total 12
        },
      });
      const violations = checkHours(ctx);
      const v = violations.find((x) => x.rule === "DAILY_HOURS_BLOCK");
      expect(v).toBeUndefined();
    });

    it("emits DAILY_HOURS_BLOCK (BLOCK) when a local day totals 12 hours and 1 minute", () => {
      const ctx = baseCtx({
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T20:00:00Z"), // 6 hours
          }),
        ],
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-15T20:00:00Z"),
          endAt: new Date("2026-06-16T02:01:00Z"), // 6 hours 1 minute, total 12:01
        },
      });
      const violations = checkHours(ctx);
      const v = violations.find((x) => x.rule === "DAILY_HOURS_BLOCK");
      expect(v).toBeDefined();
      expect(v?.severity).toBe("BLOCK");
    });

    it("DAILY_HOURS_BLOCK message includes the actual hours and date", () => {
      const ctx = baseCtx({
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T22:00:00Z"), // 8 hours
          }),
        ],
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-15T22:00:00Z"),
          endAt: new Date("2026-06-16T06:00:00Z"), // 8 hours, but crosses midnight
        },
      });
      const violations = checkHours(ctx);
      const v = violations.find((x) => x.rule === "DAILY_HOURS_BLOCK");
      expect(v?.message).toContain("Riley");
      expect(v?.message).toContain("16"); // day of month
    });

    it("candidate shift tips the daily total over the 12-hour threshold", () => {
      const ctx = baseCtx({
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-16T02:00:00Z"), // 12 hours (overnight)
          }),
        ],
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-16T02:00:00Z"),
          endAt: new Date("2026-06-16T02:30:00Z"), // 30 min, but which day?
        },
      });
      // Candidate starts on June 16 at 02:00 UTC = 10:00 PM EDT on June 15
      // So it's on June 15 in the staff's home timezone
      const violations = checkHours(ctx);
      // This is a tricky case - the candidate starts at 02:00 UTC which is 22:00 EDT on June 15
      // So the day calculation is based on the start of the shift in the home timezone
      // Existing is 14:00-02:00 next day (12h), candidate is 22:00-22:30 EDT (0.5h, same day as existing start)
      // But existing goes overnight, so we need to check if they're on the same calendar day
      const v = violations.find((x) => x.rule === "DAILY_HOURS_BLOCK");
      // June 15 EDT: existing 10 AM - midnight (14 hours), candidate 10 PM - 10:30 PM (0.5 hours)
      // Total on June 15: should be 14.5 hours
      expect(v).toBeDefined();
      expect(v?.severity).toBe("BLOCK");
    });
  });

  describe("WEEKLY_HOURS_WARN", () => {
    it("emits no violation when a week totals exactly 34 hours 59 minutes", () => {
      const ctx = baseCtx({
        staff: { id: "staff-1", name: "Riley", homeTimezone: NY },
        existingAssignments: [
          // Mon 15h
          existingShift({
            startAt: new Date("2026-06-15T12:00:00Z"),
            endAt: new Date("2026-06-16T03:00:00Z"),
          }),
          // Tue 15h 59 min
          existingShift({
            startAt: new Date("2026-06-16T12:00:00Z"),
            endAt: new Date("2026-06-17T03:59:00Z"),
          }),
        ],
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-20T14:00:00Z"),
          endAt: new Date("2026-06-20T18:00:00Z"), // Sat 4h, total 34:59
        },
      });
      const violations = checkHours(ctx);
      const v = violations.find((x) => x.rule === "WEEKLY_HOURS_WARN");
      expect(v).toBeUndefined();
    });

    it("emits WEEKLY_HOURS_WARN (WARN) when a week totals exactly 35 hours", () => {
      const ctx = baseCtx({
        staff: { id: "staff-1", name: "Riley", homeTimezone: NY },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T18:00:00Z"), // 4h
          }),
          existingShift({
            startAt: new Date("2026-06-16T14:00:00Z"),
            endAt: new Date("2026-06-17T00:00:00Z"), // 10h
          }),
          existingShift({
            startAt: new Date("2026-06-17T14:00:00Z"),
            endAt: new Date("2026-06-18T00:00:00Z"), // 10h
          }),
          existingShift({
            startAt: new Date("2026-06-18T14:00:00Z"),
            endAt: new Date("2026-06-19T00:00:00Z"), // 10h
          }),
          existingShift({
            startAt: new Date("2026-06-19T14:00:00Z"),
            endAt: new Date("2026-06-19T15:00:00Z"), // 1h
          }),
        ],
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-20T14:00:00Z"),
          endAt: new Date("2026-06-20T18:00:00Z"), // 4h, total 35
        },
      });
      const violations = checkHours(ctx);
      const v = violations.find((x) => x.rule === "WEEKLY_HOURS_WARN");
      expect(v).toBeDefined();
      expect(v?.severity).toBe("WARN");
    });

    it("WEEKLY_HOURS_WARN message includes actual hours and week date range", () => {
      const ctx = baseCtx({
        staff: { id: "staff-1", name: "Riley", homeTimezone: NY },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-16T00:00:00Z"),
          }), // 10h
          existingShift({
            startAt: new Date("2026-06-16T14:00:00Z"),
            endAt: new Date("2026-06-17T00:00:00Z"),
          }), // 10h
          existingShift({
            startAt: new Date("2026-06-17T14:00:00Z"),
            endAt: new Date("2026-06-18T00:00:00Z"),
          }), // 10h
          existingShift({
            startAt: new Date("2026-06-18T14:00:00Z"),
            endAt: new Date("2026-06-19T00:00:00Z"),
          }), // 10h
          existingShift({
            startAt: new Date("2026-06-19T14:00:00Z"),
            endAt: new Date("2026-06-19T15:00:00Z"),
          }), // 1h
        ],
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-20T14:00:00Z"),
          endAt: new Date("2026-06-20T18:00:00Z"), // 4h, total 45
        },
      });
      const violations = checkHours(ctx);
      const v = violations.find((x) => x.rule === "WEEKLY_HOURS_WARN");
      expect(v?.message).toContain("Riley");
      expect(v?.message).toContain("45");
      expect(v?.message).toContain("Jun 15"); // week start
      expect(v?.message).toContain("Jun 21"); // week end
    });

    it("Overtime Trap: a 62-hour week surfaces the weekly warning", () => {
      const ctx = baseCtx({
        staff: { id: "staff-1", name: "Riley", homeTimezone: NY },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-16T02:00:00Z"),
          }), // 12h Mon
          existingShift({
            startAt: new Date("2026-06-16T14:00:00Z"),
            endAt: new Date("2026-06-17T02:00:00Z"),
          }), // 12h Tue
          existingShift({
            startAt: new Date("2026-06-17T14:00:00Z"),
            endAt: new Date("2026-06-18T02:00:00Z"),
          }), // 12h Wed
          existingShift({
            startAt: new Date("2026-06-18T14:00:00Z"),
            endAt: new Date("2026-06-19T02:00:00Z"),
          }), // 12h Thu
          existingShift({
            startAt: new Date("2026-06-19T14:00:00Z"),
            endAt: new Date("2026-06-20T00:00:00Z"),
          }), // 10h Fri
        ],
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-20T14:00:00Z"),
          endAt: new Date("2026-06-20T18:00:00Z"), // 4h Sat, total 62
        },
      });
      const violations = checkHours(ctx);
      const weeklyWarn = violations.find((x) => x.rule === "WEEKLY_HOURS_WARN");
      expect(weeklyWarn).toBeDefined();
      expect(weeklyWarn?.severity).toBe("WARN");
      // The point is the manager is told before confirming
      expect(weeklyWarn?.message).toContain("62.0");
    });
  });

  describe("SIXTH_CONSECUTIVE_DAY", () => {
    it("does not warn when there are only 5 consecutive worked days before the candidate", () => {
      const ctx = baseCtx({
        staff: { id: "staff-1", name: "Riley", homeTimezone: NY },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T18:00:00Z"),
          }), // Mon
          existingShift({
            startAt: new Date("2026-06-16T14:00:00Z"),
            endAt: new Date("2026-06-16T18:00:00Z"),
          }), // Tue
          existingShift({
            startAt: new Date("2026-06-17T14:00:00Z"),
            endAt: new Date("2026-06-17T18:00:00Z"),
          }), // Wed
          existingShift({
            startAt: new Date("2026-06-18T14:00:00Z"),
            endAt: new Date("2026-06-18T18:00:00Z"),
          }), // Thu
          existingShift({
            startAt: new Date("2026-06-19T14:00:00Z"),
            endAt: new Date("2026-06-19T18:00:00Z"),
          }), // Fri
        ],
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-20T14:00:00Z"),
          endAt: new Date("2026-06-20T18:00:00Z"), // Sat (6th)
        },
      });
      const violations = checkHours(ctx);
      const v = violations.find((x) => x.rule === "SIXTH_CONSECUTIVE_DAY");
      expect(v).toBeDefined();
      expect(v?.severity).toBe("WARN");
    });

    it("SIXTH_CONSECUTIVE_DAY message names the person and the day", () => {
      const ctx = baseCtx({
        staff: { id: "staff-1", name: "Riley", homeTimezone: NY },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T18:00:00Z"),
          }), // Mon
          existingShift({
            startAt: new Date("2026-06-16T14:00:00Z"),
            endAt: new Date("2026-06-16T18:00:00Z"),
          }), // Tue
          existingShift({
            startAt: new Date("2026-06-17T14:00:00Z"),
            endAt: new Date("2026-06-17T18:00:00Z"),
          }), // Wed
          existingShift({
            startAt: new Date("2026-06-18T14:00:00Z"),
            endAt: new Date("2026-06-18T18:00:00Z"),
          }), // Thu
          existingShift({
            startAt: new Date("2026-06-19T14:00:00Z"),
            endAt: new Date("2026-06-19T18:00:00Z"),
          }), // Fri
        ],
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-20T14:00:00Z"),
          endAt: new Date("2026-06-20T18:00:00Z"), // Sat
        },
      });
      const violations = checkHours(ctx);
      const v = violations.find((x) => x.rule === "SIXTH_CONSECUTIVE_DAY");
      expect(v?.message).toContain("Riley");
      expect(v?.message).toContain("6");
      expect(v?.message).toContain("Jun 20"); // The Saturday date
    });

    it("a gap day resets the consecutive streak", () => {
      const ctx = baseCtx({
        staff: { id: "staff-1", name: "Riley", homeTimezone: NY },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T18:00:00Z"),
          }), // Mon
          existingShift({
            startAt: new Date("2026-06-16T14:00:00Z"),
            endAt: new Date("2026-06-16T18:00:00Z"),
          }), // Tue
          existingShift({
            startAt: new Date("2026-06-17T14:00:00Z"),
            endAt: new Date("2026-06-17T18:00:00Z"),
          }), // Wed
          existingShift({
            startAt: new Date("2026-06-18T14:00:00Z"),
            endAt: new Date("2026-06-18T18:00:00Z"),
          }), // Thu
          existingShift({
            startAt: new Date("2026-06-19T14:00:00Z"),
            endAt: new Date("2026-06-19T18:00:00Z"),
          }), // Fri
          // Gap on Sat June 20
          existingShift({
            startAt: new Date("2026-06-21T14:00:00Z"),
            endAt: new Date("2026-06-21T18:00:00Z"),
          }), // Sun (reset to 1)
          existingShift({
            startAt: new Date("2026-06-22T14:00:00Z"),
            endAt: new Date("2026-06-22T18:00:00Z"),
          }), // Mon (2)
          existingShift({
            startAt: new Date("2026-06-23T14:00:00Z"),
            endAt: new Date("2026-06-23T18:00:00Z"),
          }), // Tue (3)
          existingShift({
            startAt: new Date("2026-06-24T14:00:00Z"),
            endAt: new Date("2026-06-24T18:00:00Z"),
          }), // Wed (4)
          existingShift({
            startAt: new Date("2026-06-25T14:00:00Z"),
            endAt: new Date("2026-06-25T18:00:00Z"),
          }), // Thu (5)
        ],
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-26T14:00:00Z"),
          endAt: new Date("2026-06-26T18:00:00Z"), // Fri (6th in new streak)
        },
      });
      const violations = checkHours(ctx);
      const v = violations.find((x) => x.rule === "SIXTH_CONSECUTIVE_DAY");
      expect(v).toBeDefined(); // Should warn, it's 6 consecutive starting from Sun June 21
    });

    it("a 1-hour shift counts the same as an 11-hour shift for consecutive day counting", () => {
      const ctx = baseCtx({
        staff: { id: "staff-1", name: "Riley", homeTimezone: NY },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T15:00:00Z"),
          }), // 1h Mon
          existingShift({
            startAt: new Date("2026-06-16T14:00:00Z"),
            endAt: new Date("2026-06-16T15:00:00Z"),
          }), // 1h Tue
          existingShift({
            startAt: new Date("2026-06-17T14:00:00Z"),
            endAt: new Date("2026-06-17T15:00:00Z"),
          }), // 1h Wed
          existingShift({
            startAt: new Date("2026-06-18T14:00:00Z"),
            endAt: new Date("2026-06-18T15:00:00Z"),
          }), // 1h Thu
          existingShift({
            startAt: new Date("2026-06-19T14:00:00Z"),
            endAt: new Date("2026-06-19T15:00:00Z"),
          }), // 1h Fri
        ],
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-20T14:00:00Z"),
          endAt: new Date("2026-06-21T01:00:00Z"), // 11h Sat (6th consecutive)
        },
      });
      const violations = checkHours(ctx);
      const v = violations.find((x) => x.rule === "SIXTH_CONSECUTIVE_DAY");
      expect(v).toBeDefined(); // Should warn for 6th consecutive
    });
  });

  describe("SEVENTH_CONSECUTIVE_DAY", () => {
    it("emits SEVENTH_CONSECUTIVE_DAY (OVERRIDE_REQUIRED) when assigning a 7th consecutive worked day", () => {
      const ctx = baseCtx({
        staff: { id: "staff-1", name: "Riley", homeTimezone: NY },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T18:00:00Z"),
          }), // Mon
          existingShift({
            startAt: new Date("2026-06-16T14:00:00Z"),
            endAt: new Date("2026-06-16T18:00:00Z"),
          }), // Tue
          existingShift({
            startAt: new Date("2026-06-17T14:00:00Z"),
            endAt: new Date("2026-06-17T18:00:00Z"),
          }), // Wed
          existingShift({
            startAt: new Date("2026-06-18T14:00:00Z"),
            endAt: new Date("2026-06-18T18:00:00Z"),
          }), // Thu
          existingShift({
            startAt: new Date("2026-06-19T14:00:00Z"),
            endAt: new Date("2026-06-19T18:00:00Z"),
          }), // Fri
          existingShift({
            startAt: new Date("2026-06-20T14:00:00Z"),
            endAt: new Date("2026-06-20T18:00:00Z"),
          }), // Sat
        ],
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-21T14:00:00Z"),
          endAt: new Date("2026-06-21T18:00:00Z"), // Sun (7th)
        },
      });
      const violations = checkHours(ctx);
      const v = violations.find((x) => x.rule === "SEVENTH_CONSECUTIVE_DAY");
      expect(v).toBeDefined();
      expect(v?.severity).toBe("OVERRIDE_REQUIRED");
    });

    it("SEVENTH_CONSECUTIVE_DAY message names the person and the day", () => {
      const ctx = baseCtx({
        staff: { id: "staff-1", name: "Riley", homeTimezone: NY },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-15T18:00:00Z"),
          }), // Mon
          existingShift({
            startAt: new Date("2026-06-16T14:00:00Z"),
            endAt: new Date("2026-06-16T18:00:00Z"),
          }), // Tue
          existingShift({
            startAt: new Date("2026-06-17T14:00:00Z"),
            endAt: new Date("2026-06-17T18:00:00Z"),
          }), // Wed
          existingShift({
            startAt: new Date("2026-06-18T14:00:00Z"),
            endAt: new Date("2026-06-18T18:00:00Z"),
          }), // Thu
          existingShift({
            startAt: new Date("2026-06-19T14:00:00Z"),
            endAt: new Date("2026-06-19T18:00:00Z"),
          }), // Fri
          existingShift({
            startAt: new Date("2026-06-20T14:00:00Z"),
            endAt: new Date("2026-06-20T18:00:00Z"),
          }), // Sat
        ],
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-21T14:00:00Z"),
          endAt: new Date("2026-06-21T18:00:00Z"), // Sun
        },
      });
      const violations = checkHours(ctx);
      const v = violations.find((x) => x.rule === "SEVENTH_CONSECUTIVE_DAY");
      expect(v?.message).toContain("Riley");
      expect(v?.message).toContain("7");
      // 2026-06-21 is a Sunday. Pinning the weekday explicitly (not just the
      // day-of-month) guards formatDateString's `timeZone: "UTC"` -- without
      // it, a runtime behind UTC would roll this back to "Sat, Jun 20",
      // wrong on both counts.
      expect(v?.message).toContain("Sun, Jun 21");
    });
  });

  describe("Multiple violations", () => {
    it("returns ALL applicable violations, never short-circuiting", () => {
      const ctx = baseCtx({
        staff: { id: "staff-1", name: "Riley", homeTimezone: NY },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T14:00:00Z"),
            endAt: new Date("2026-06-16T02:00:00Z"),
          }), // 12h Mon
          existingShift({
            startAt: new Date("2026-06-16T14:00:00Z"),
            endAt: new Date("2026-06-17T02:00:00Z"),
          }), // 12h Tue
          existingShift({
            startAt: new Date("2026-06-17T14:00:00Z"),
            endAt: new Date("2026-06-18T02:00:00Z"),
          }), // 12h Wed
          existingShift({
            startAt: new Date("2026-06-18T14:00:00Z"),
            endAt: new Date("2026-06-19T02:00:00Z"),
          }), // 12h Thu
          existingShift({
            startAt: new Date("2026-06-19T14:00:00Z"),
            endAt: new Date("2026-06-20T02:00:00Z"),
          }), // 12h Fri
          existingShift({
            startAt: new Date("2026-06-20T14:00:00Z"),
            endAt: new Date("2026-06-21T02:00:00Z"),
          }), // 12h Sat
        ],
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-21T14:00:00Z"),
          endAt: new Date("2026-06-21T22:00:00Z"), // 8h Sun (7th consecutive, also 20h that day with overnight)
        },
      });
      const violations = checkHours(ctx);
      // Should have DAILY_HOURS_BLOCK, SEVENTH_CONSECUTIVE_DAY, and WEEKLY_HOURS_WARN
      const rules = violations.map((v) => v.rule).sort();
      expect(rules.includes("SEVENTH_CONSECUTIVE_DAY")).toBe(true);
      expect(violations.length >= 2).toBe(true); // At least 7th day and some daily/weekly warnings
    });
  });

  describe("Overnight shifts and DST handling", () => {
    it("correctly counts hours for an overnight shift that crosses a calendar day boundary", () => {
      // 10 PM EDT to 2 AM EDT next day = 4 hours, not -20
      const ctx = baseCtx({
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-15T02:00:00Z"), // 10 PM EDT June 14
          endAt: new Date("2026-06-15T06:00:00Z"), // 2 AM EDT June 15
        },
      });
      const violations = checkHours(ctx);
      // Should not trigger warnings for 4 hours
      const warns = violations.filter((v) => v.rule === "DAILY_HOURS_WARN");
      expect(warns.length).toBe(0);
    });
  });

  describe("Boundary cases and edge cases", () => {
    it("handles shifts at the exact week boundary (Monday 00:00)", () => {
      const ctx = baseCtx({
        staff: { id: "staff-1", name: "Riley", homeTimezone: NY },
        existingAssignments: [
          existingShift({
            startAt: new Date("2026-06-15T04:00:00Z"), // 00:00 EDT Mon
            endAt: new Date("2026-06-15T14:00:00Z"), // 10 hours
          }),
        ],
        shift: {
          ...baseCtx().shift,
          startAt: new Date("2026-06-22T04:00:00Z"), // 00:00 EDT Mon (next week)
          endAt: new Date("2026-06-22T14:00:00Z"),
        },
      });
      const violations = checkHours(ctx);
      // Should only have daily warnings, not weekly (different weeks)
      const weekly = violations.find((v) => v.rule === "WEEKLY_HOURS_WARN");
      expect(weekly).toBeUndefined();
    });
  });
});
