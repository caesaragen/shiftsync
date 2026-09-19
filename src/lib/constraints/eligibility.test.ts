import { describe, it, expect } from "vitest";
import type { Availability } from "@prisma/client";
import { checkEligibility } from "./eligibility";
import type { EngineContext } from "./types";

const NY = "America/New_York";

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
      startAt: new Date("2026-06-15T14:00:00Z"),
      endAt: new Date("2026-06-15T18:00:00Z"),
      requiredSkillId: "skill-bartender",
    },
    skillIds: ["skill-bartender"],
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
    const ctx = baseCtx({ skillIds: ["skill-barista"] });
    const violations = checkEligibility(ctx);
    const v = violations.find((x) => x.rule === "SKILL_MISMATCH");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("BLOCK");
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
      skillIds: ["skill-barista"], // wrong skill
      activeCertificationLocationIds: ["loc-other"], // wrong location
      availability: [], // fails closed: unavailable
    });
    const violations = checkEligibility(ctx);
    const rules = violations.map((v) => v.rule).sort();
    expect(rules).toEqual(["NOT_CERTIFIED", "SKILL_MISMATCH", "UNAVAILABLE"]);
    expect(violations).toHaveLength(3);
    expect(violations.every((v) => v.severity === "BLOCK")).toBe(true);
  });

  it("Timezone Tangle: UNAVAILABLE message names the person, states the available window and the shift's actual conflicting times", () => {
    const ctx = baseCtx({
      staff: { id: "staff-1", name: "Jordan", homeTimezone: NY },
      availability: [
        availRow({ kind: "RECURRING", dayOfWeek: 1, startMinutes: 9 * 60, endMinutes: 17 * 60 }),
      ],
      shift: {
        id: "shift-2",
        locationId: "loc-pier39",
        requiredSkillId: "skill-bartender",
        // 09:00-17:00 Pacific on Monday 2026-06-15 == 12:00-20:00 Eastern
        startAt: new Date("2026-06-15T16:00:00Z"),
        endAt: new Date("2026-06-16T00:00:00Z"),
      },
    });
    const violations = checkEligibility(ctx);
    const v = violations.find((x) => x.rule === "UNAVAILABLE");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("BLOCK");
    // Names the person
    expect(v?.message).toContain("Jordan");
    // States the specific conflicting times, not a generic "not available"
    expect(v?.message).not.toMatch(/^not available$/i);
    expect(v?.message).toMatch(/9:00\s*AM/i);
    expect(v?.message).toMatch(/5:00\s*PM/i);
    expect(v?.message).toMatch(/12:00\s*PM/i);
    expect(v?.message).toMatch(/8:00\s*PM/i);
  });

  it("SKILL_MISMATCH message includes the specific required skill, not a generic phrase", () => {
    const ctx = baseCtx({ skillIds: [] });
    const violations = checkEligibility(ctx);
    const v = violations.find((x) => x.rule === "SKILL_MISMATCH");
    expect(v?.message).toContain("skill-bartender");
    expect(v?.message).not.toMatch(/^not qualified$/i);
  });

  it("NOT_CERTIFIED message includes the specific location, not a generic phrase", () => {
    const ctx = baseCtx({ activeCertificationLocationIds: [] });
    const violations = checkEligibility(ctx);
    const v = violations.find((x) => x.rule === "NOT_CERTIFIED");
    expect(v?.message).toContain("loc-pier39");
    expect(v?.message).not.toMatch(/^not certified$/i);
  });
});
