import { describe, it, expect } from "vitest";
import type { Availability } from "@prisma/client";
import { checkEligibility } from "./eligibility";
import type { EngineContext } from "./types";

const NY = "America/New_York";
const LA = "America/Los_Angeles";

let seq = 0;
function availRow(overrides: Partial<Availability> & Pick<Availability, "kind">): Availability {
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

function baseCtx(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    staff: { id: "staff-1", name: "Jordan", homeTimezone: NY },
    shift: {
      id: "shift-1",
      locationId: "loc-pier39",
      locationName: "Pier 39",
      locationTimezone: NY,
      startAt: new Date("2026-06-15T14:00:00Z"),
      endAt: new Date("2026-06-15T18:00:00Z"),
      requiredSkillId: "skill-bartender",
      requiredSkillName: "bartender",
    },
    skills: [{ id: "skill-bartender", name: "bartender" }],
    activeCertificationLocationIds: ["loc-pier39"],
    availability: [
      availRow({ kind: "RECURRING", dayOfWeek: 1, startMinutes: 9 * 60, endMinutes: 17 * 60 }),
    ],
    existingAssignments: [],
    ...overrides,
  };
}

describe("checkEligibility", () => {
  it("emits no violations when the staff member is fully eligible", () => {
    const ctx = baseCtx();
    expect(checkEligibility(ctx)).toEqual([]);
  });

  it("emits SKILL_MISMATCH (BLOCK) when the staff member lacks the required skill", () => {
    const ctx = baseCtx({ skills: [{ id: "skill-barista", name: "barista" }] });
    const violations = checkEligibility(ctx);
    const v = violations.find((x) => x.rule === "SKILL_MISMATCH");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("BLOCK");
    expect(v?.message).toContain("Jordan");
  });

  it("SKILL_MISMATCH message names the required skill and what the staff member actually has, not a generic phrase or a raw id", () => {
    const ctx = baseCtx({
      skills: [
        { id: "skill-server", name: "server" },
        { id: "skill-host", name: "host" },
      ],
    });
    const violations = checkEligibility(ctx);
    const v = violations.find((x) => x.rule === "SKILL_MISMATCH");
    expect(v?.message).toContain("bartender"); // the required skill, by name
    expect(v?.message).toContain("server");
    expect(v?.message).toContain("host");
    expect(v?.message).not.toContain("skill-bartender"); // no raw ids leaking into the message
    expect(v?.message).not.toMatch(/^not qualified$/i);
  });

  it("SKILL_MISMATCH message reads sensibly when the staff member has no skills at all", () => {
    const ctx = baseCtx({ skills: [] });
    const violations = checkEligibility(ctx);
    const v = violations.find((x) => x.rule === "SKILL_MISMATCH");
    expect(v?.message).toContain("bartender");
    expect(v?.message).toContain("Jordan");
  });

  it("emits NOT_CERTIFIED (BLOCK) when the staff member has no active certification at the shift's location", () => {
    const ctx = baseCtx({ activeCertificationLocationIds: ["loc-other"] });
    const violations = checkEligibility(ctx);
    const v = violations.find((x) => x.rule === "NOT_CERTIFIED");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("BLOCK");
    expect(v?.message).toContain("Jordan");
  });

  it("NOT_CERTIFIED message names the specific location, not a generic phrase or a raw id", () => {
    const ctx = baseCtx({ activeCertificationLocationIds: [] });
    const violations = checkEligibility(ctx);
    const v = violations.find((x) => x.rule === "NOT_CERTIFIED");
    expect(v?.message).toContain("Pier 39");
    expect(v?.message).not.toContain("loc-pier39");
    expect(v?.message).not.toMatch(/^not certified$/i);
  });

  it("NOT_CERTIFIED message mentions certifications held elsewhere, when there are any", () => {
    const ctx = baseCtx({ activeCertificationLocationIds: ["loc-other-1", "loc-other-2"] });
    const violations = checkEligibility(ctx);
    const v = violations.find((x) => x.rule === "NOT_CERTIFIED");
    expect(v?.message).toContain("Pier 39");
    expect(v?.message).toMatch(/2 other location/i);
  });

  it("emits UNAVAILABLE (BLOCK) when Task 3's matcher says the staff member is not available", () => {
    const ctx = baseCtx({
      availability: [
        availRow({ kind: "RECURRING", dayOfWeek: 1, startMinutes: 9 * 60, endMinutes: 12 * 60 }),
      ],
      shift: {
        ...baseCtx().shift,
        startAt: new Date("2026-06-15T14:00:00Z"), // 10:00 EDT
        endAt: new Date("2026-06-15T18:00:00Z"), // 14:00 EDT -- past the 12:00 window close
      },
    });
    const violations = checkEligibility(ctx);
    const v = violations.find((x) => x.rule === "UNAVAILABLE");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("BLOCK");
    expect(v?.message).toContain("Jordan");
  });

  it("returns ALL applicable violations at once, not just the first (does not short-circuit)", () => {
    const ctx = baseCtx({
      skills: [{ id: "skill-barista", name: "barista" }], // wrong skill
      activeCertificationLocationIds: ["loc-other"], // wrong location
      availability: [], // fails closed: unavailable
    });
    const violations = checkEligibility(ctx);
    const rules = violations.map((v) => v.rule).sort();
    expect(rules).toEqual(["NOT_CERTIFIED", "SKILL_MISMATCH", "UNAVAILABLE"]);
    expect(violations).toHaveLength(3);
    expect(violations.every((v) => v.severity === "BLOCK")).toBe(true);
  });

  it("Timezone Tangle: UNAVAILABLE message states the shift's time in the LOCATION's zone, its converted time in the staff member's HOME zone, and the staff member's actual available window", () => {
    const ctx = baseCtx({
      staff: { id: "staff-1", name: "Jordan", homeTimezone: NY },
      availability: [
        availRow({ kind: "RECURRING", dayOfWeek: 1, startMinutes: 9 * 60, endMinutes: 17 * 60 }),
      ],
      shift: {
        id: "shift-2",
        locationId: "loc-pier39",
        locationName: "Pier 39",
        locationTimezone: LA, // the shift's own location is Pacific
        requiredSkillId: "skill-bartender",
        requiredSkillName: "bartender",
        // 09:00-17:00 Pacific on Monday 2026-06-15 == 12:00-20:00 Eastern
        startAt: new Date("2026-06-15T16:00:00Z"),
        endAt: new Date("2026-06-16T00:00:00Z"),
      },
    });
    const violations = checkEligibility(ctx);
    const v = violations.find((x) => x.rule === "UNAVAILABLE");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("BLOCK");
    const message = v?.message ?? "";

    // Names the person and the location.
    expect(message).toContain("Jordan");
    expect(message).toContain("Pier 39");
    expect(message).not.toMatch(/^not available$/i);

    // The shift's time in the LOCATION's zone (Pacific): 9:00 AM-5:00 PM.
    expect(message).toMatch(/9:00\s*AM/i);
    expect(message).toMatch(/5:00\s*PM/i);
    // The SAME shift's time converted to the staff member's HOME zone
    // (Eastern): 12:00 PM-8:00 PM -- this is what actually conflicts.
    expect(message).toMatch(/12:00\s*PM/i);
    expect(message).toMatch(/8:00\s*PM/i);

    // Both zone labels appear, distinctly, and are not hardcoded strings
    // baked into the message unconditionally -- they are the real
    // abbreviations for Pacific and Eastern on 2026-06-15 (both daylight
    // time: PDT and EDT).
    expect(message).toMatch(/PDT/);
    expect(message).toMatch(/EDT/);
  });

  it("Timezone Tangle: does not spuriously duplicate the zone explanation when location and home zone are the same", () => {
    const ctx = baseCtx({
      availability: [
        availRow({ kind: "RECURRING", dayOfWeek: 1, startMinutes: 9 * 60, endMinutes: 12 * 60 }),
      ],
      shift: {
        ...baseCtx().shift,
        locationTimezone: NY, // same zone as staff.homeTimezone
        startAt: new Date("2026-06-15T14:00:00Z"), // 10:00 EDT
        endAt: new Date("2026-06-15T18:00:00Z"), // 14:00 EDT
      },
    });
    const violations = checkEligibility(ctx);
    const v = violations.find((x) => x.rule === "UNAVAILABLE");
    // Same zone on both sides -- no "which is X in Jordan's home timezone"
    // clause needed since there is nothing to convert.
    expect(v?.message).not.toMatch(/home timezone/i);
  });
});
