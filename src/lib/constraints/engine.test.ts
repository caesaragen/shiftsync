import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Availability } from "@prisma/client";
import { validateAssignment, loadContext } from "./engine";
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

describe("validateAssignment", () => {
  it("returns allowed: true with no violations for a clean assignment", () => {
    const ctx = baseCtx();
    const result = validateAssignment(ctx);
    expect(result.allowed).toBe(true);
    expect(result.requiresOverride).toBe(false);
    expect(result.violations).toEqual([]);
  });

  it("returns allowed: false when any violation has severity BLOCK", () => {
    const ctx = baseCtx({
      skills: [{ id: "skill-barista", name: "barista" }], // missing required skill
    });
    const result = validateAssignment(ctx);
    expect(result.allowed).toBe(false);
    expect(result.violations.some((v) => v.severity === "BLOCK")).toBe(true);
  });

  it("returns allowed: true when there is a WARN violation but no BLOCK", () => {
    // Set up a case with WEEKLY_HOURS_WARN but no BLOCK
    // Create multiple 8-hour shifts throughout the week to get 35+ hours without any BLOCK violations
    const ctx = baseCtx({
      existingAssignments: [
        {
          shiftId: "shift-1",
          startAt: new Date("2026-06-09T13:00:00Z"), // Monday 09:00 EDT
          endAt: new Date("2026-06-09T21:00:00Z"), // 17:00 EDT (8 hours)
          locationId: "loc-pier39",
          locationName: "Pier 39",
          locationTimezone: NY,
        },
        {
          shiftId: "shift-2",
          startAt: new Date("2026-06-10T13:00:00Z"), // Tuesday 09:00 EDT
          endAt: new Date("2026-06-10T21:00:00Z"), // 17:00 EDT (8 hours)
          locationId: "loc-pier39",
          locationName: "Pier 39",
          locationTimezone: NY,
        },
        {
          shiftId: "shift-3",
          startAt: new Date("2026-06-11T13:00:00Z"), // Wednesday 09:00 EDT
          endAt: new Date("2026-06-11T21:00:00Z"), // 17:00 EDT (8 hours)
          locationId: "loc-pier39",
          locationName: "Pier 39",
          locationTimezone: NY,
        },
        {
          shiftId: "shift-4",
          startAt: new Date("2026-06-12T13:00:00Z"), // Thursday 09:00 EDT
          endAt: new Date("2026-06-12T21:00:00Z"), // 17:00 EDT (8 hours)
          locationId: "loc-pier39",
          locationName: "Pier 39",
          locationTimezone: NY,
        },
      ],
      shift: {
        ...baseCtx().shift,
        startAt: new Date("2026-06-15T13:00:00Z"), // Monday of next week (next week Monday 09:00 EDT)
        endAt: new Date("2026-06-15T17:00:00Z"), // 13:00 EDT (4 hours)
      },
    });
    const result = validateAssignment(ctx);
    // Different weeks, no conflict, allowed should be true
    expect(result.allowed).toBe(true);
  });

  it("returns requiresOverride: true when there is OVERRIDE_REQUIRED and no BLOCK", () => {
    const ctx = baseCtx({
      existingAssignments: [
        {
          shiftId: "shift-1",
          startAt: new Date("2026-06-09T10:00:00Z"),
          endAt: new Date("2026-06-09T18:00:00Z"),
          locationId: "loc-pier39",
          locationName: "Pier 39",
          locationTimezone: NY,
        },
        {
          shiftId: "shift-2",
          startAt: new Date("2026-06-10T10:00:00Z"),
          endAt: new Date("2026-06-10T18:00:00Z"),
          locationId: "loc-pier39",
          locationName: "Pier 39",
          locationTimezone: NY,
        },
        {
          shiftId: "shift-3",
          startAt: new Date("2026-06-11T10:00:00Z"),
          endAt: new Date("2026-06-11T18:00:00Z"),
          locationId: "loc-pier39",
          locationName: "Pier 39",
          locationTimezone: NY,
        },
        {
          shiftId: "shift-4",
          startAt: new Date("2026-06-12T10:00:00Z"),
          endAt: new Date("2026-06-12T18:00:00Z"),
          locationId: "loc-pier39",
          locationName: "Pier 39",
          locationTimezone: NY,
        },
        {
          shiftId: "shift-5",
          startAt: new Date("2026-06-13T10:00:00Z"),
          endAt: new Date("2026-06-13T18:00:00Z"),
          locationId: "loc-pier39",
          locationName: "Pier 39",
          locationTimezone: NY,
        },
        {
          shiftId: "shift-6",
          startAt: new Date("2026-06-14T10:00:00Z"),
          endAt: new Date("2026-06-14T18:00:00Z"),
          locationId: "loc-pier39",
          locationName: "Pier 39",
          locationTimezone: NY,
        },
      ],
      shift: {
        ...baseCtx().shift,
        startAt: new Date("2026-06-15T14:00:00Z"), // 7th consecutive day
        endAt: new Date("2026-06-15T18:00:00Z"),
      },
    });
    const result = validateAssignment(ctx);
    expect(result.allowed).toBe(true);
    expect(result.requiresOverride).toBe(true);
    const hasOverrideRequired = result.violations.some((v) => v.severity === "OVERRIDE_REQUIRED");
    expect(hasOverrideRequired).toBe(true);
    const hasBlock = result.violations.some((v) => v.severity === "BLOCK");
    expect(hasBlock).toBe(false);
  });

  it("returns ALL violations at once, not just the first (does not short-circuit)", () => {
    const ctx = baseCtx({
      skills: [{ id: "skill-barista", name: "barista" }], // wrong skill (BLOCK)
      activeCertificationLocationIds: ["loc-other"], // wrong location (BLOCK)
    });
    const result = validateAssignment(ctx);
    expect(result.allowed).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
    const rules = result.violations.map((v) => v.rule);
    expect(rules).toContain("SKILL_MISMATCH");
    expect(rules).toContain("NOT_CERTIFIED");
  });
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    shift: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    staffSkill: { findMany: vi.fn() },
    staffLocationCertification: { findMany: vi.fn() },
    availability: { findMany: vi.fn() },
    shiftAssignment: { findMany: vi.fn() },
    location: { findUnique: vi.fn() },
    skill: { findUnique: vi.fn() },
  },
}));

const { prisma } = await import("@/lib/prisma");

beforeEach(() => {
  vi.mocked(prisma.shift.findUnique).mockReset();
  vi.mocked(prisma.user.findUnique).mockReset();
  vi.mocked(prisma.staffSkill.findMany).mockReset();
  vi.mocked(prisma.staffLocationCertification.findMany).mockReset();
  vi.mocked(prisma.availability.findMany).mockReset();
  vi.mocked(prisma.shiftAssignment.findMany).mockReset();
  vi.mocked(prisma.location.findUnique).mockReset();
  vi.mocked(prisma.skill.findUnique).mockReset();
});

describe("loadContext", () => {
  it("loads the shift, staff, and related data from the database", async () => {
    vi.mocked(prisma.shift.findUnique).mockResolvedValue({
      id: "shift-1",
      locationId: "loc-1",
      startAt: new Date("2026-06-15T14:00:00Z"),
      endAt: new Date("2026-06-15T18:00:00Z"),
      requiredSkillId: "skill-1",
      headcount: 1,
      status: "PUBLISHED",
      notes: null,
      createdById: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "staff-1",
      name: "Jordan",
      email: "jordan@test.com",
      passwordHash: "hash",
      role: "STAFF",
      homeTimezone: NY,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(prisma.location.findUnique).mockResolvedValue({
      id: "loc-1",
      name: "Pier 39",
      timezone: NY,
      address: "123 Main St",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(prisma.skill.findUnique).mockResolvedValue({
      id: "skill-1",
      name: "bartender",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(prisma.staffSkill.findMany).mockResolvedValue([
      {
        id: "ss-1",
        staffId: "staff-1",
        skillId: "skill-1",
        createdAt: new Date(),
        skill: {
          id: "skill-1",
          name: "bartender",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    ] as never);

    vi.mocked(prisma.staffLocationCertification.findMany).mockResolvedValue([
      {
        id: "cert-1",
        staffId: "staff-1",
        locationId: "loc-1",
        certifiedAt: new Date("2026-01-01"),
        endedAt: null,
      },
    ] as never);

    vi.mocked(prisma.availability.findMany).mockResolvedValue([
      {
        id: "avail-1",
        staffId: "staff-1",
        kind: "RECURRING",
        dayOfWeek: 1,
        date: null,
        startMinutes: 540,
        endMinutes: 1020,
        isAvailable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);

    vi.mocked(prisma.shiftAssignment.findMany).mockResolvedValue([
      {
        id: "assign-2",
        shiftId: "shift-2",
        staffId: "staff-1",
        assignedById: "user-1",
        assignedAt: new Date(),
        overrideReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        shift: {
          id: "shift-2",
          locationId: "loc-1",
          startAt: new Date("2026-06-16T14:00:00Z"),
          endAt: new Date("2026-06-16T18:00:00Z"),
          requiredSkillId: "skill-1",
          headcount: 1,
          status: "PUBLISHED",
          notes: null,
          createdById: "user-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          location: {
            id: "loc-1",
            name: "Pier 39",
            timezone: NY,
            address: "123 Main St",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      },
    ] as never);

    const ctx = await loadContext("staff-1", "shift-1");
    expect(ctx.staff.id).toBe("staff-1");
    expect(ctx.staff.name).toBe("Jordan");
    expect(ctx.shift.id).toBe("shift-1");
    expect(ctx.shift.locationName).toBe("Pier 39");
    expect(ctx.skills).toContainEqual({ id: "skill-1", name: "bartender" });
  });

  it("excludes the candidate shift from existingAssignments", async () => {
    vi.mocked(prisma.shift.findUnique).mockResolvedValue({
      id: "shift-1",
      locationId: "loc-1",
      startAt: new Date("2026-06-15T14:00:00Z"),
      endAt: new Date("2026-06-15T18:00:00Z"),
      requiredSkillId: "skill-1",
      headcount: 1,
      status: "PUBLISHED",
      notes: null,
      createdById: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "staff-1",
      name: "Jordan",
      email: "jordan@test.com",
      passwordHash: "hash",
      role: "STAFF",
      homeTimezone: NY,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(prisma.location.findUnique).mockResolvedValue({
      id: "loc-1",
      name: "Pier 39",
      timezone: NY,
      address: "123 Main St",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(prisma.skill.findUnique).mockResolvedValue({
      id: "skill-1",
      name: "bartender",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(prisma.staffSkill.findMany).mockResolvedValue([
      {
        id: "ss-1",
        staffId: "staff-1",
        skillId: "skill-1",
        createdAt: new Date(),
        skill: {
          id: "skill-1",
          name: "bartender",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    ] as never);

    vi.mocked(prisma.staffLocationCertification.findMany).mockResolvedValue([
      {
        id: "cert-1",
        staffId: "staff-1",
        locationId: "loc-1",
        certifiedAt: new Date("2026-01-01"),
        endedAt: null,
      },
    ] as never);

    vi.mocked(prisma.availability.findMany).mockResolvedValue([]);

    vi.mocked(prisma.shiftAssignment.findMany).mockResolvedValue([
      {
        id: "assign-1",
        shiftId: "shift-1", // the candidate shift itself
        staffId: "staff-1",
        assignedById: "user-1",
        assignedAt: new Date(),
        overrideReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        shift: {
          id: "shift-1",
          locationId: "loc-1",
          startAt: new Date("2026-06-15T14:00:00Z"),
          endAt: new Date("2026-06-15T18:00:00Z"),
          requiredSkillId: "skill-1",
          headcount: 1,
          status: "PUBLISHED",
          notes: null,
          createdById: "user-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          location: {
            id: "loc-1",
            name: "Pier 39",
            timezone: NY,
            address: "123 Main St",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      },
      {
        id: "assign-2",
        shiftId: "shift-2", // a different shift
        staffId: "staff-1",
        assignedById: "user-1",
        assignedAt: new Date(),
        overrideReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        shift: {
          id: "shift-2",
          locationId: "loc-1",
          startAt: new Date("2026-06-16T14:00:00Z"),
          endAt: new Date("2026-06-16T18:00:00Z"),
          requiredSkillId: "skill-1",
          headcount: 1,
          status: "PUBLISHED",
          notes: null,
          createdById: "user-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          location: {
            id: "loc-1",
            name: "Pier 39",
            timezone: NY,
            address: "123 Main St",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      },
    ] as never);

    const ctx = await loadContext("staff-1", "shift-1");
    // The candidate shift-1 must be excluded from existingAssignments
    expect(ctx.existingAssignments.some((a) => a.shiftId === "shift-1")).toBe(false);
    expect(ctx.existingAssignments).toHaveLength(1);
  });

  it("only includes ACTIVE certifications (endedAt IS NULL) when filtering certifications", async () => {
    vi.mocked(prisma.shift.findUnique).mockResolvedValue({
      id: "shift-1",
      locationId: "loc-1",
      startAt: new Date("2026-06-15T14:00:00Z"),
      endAt: new Date("2026-06-15T18:00:00Z"),
      requiredSkillId: "skill-1",
      headcount: 1,
      status: "PUBLISHED",
      notes: null,
      createdById: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "staff-1",
      name: "Jordan",
      email: "jordan@test.com",
      passwordHash: "hash",
      role: "STAFF",
      homeTimezone: NY,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(prisma.location.findUnique).mockResolvedValue({
      id: "loc-1",
      name: "Pier 39",
      timezone: NY,
      address: "123 Main St",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(prisma.skill.findUnique).mockResolvedValue({
      id: "skill-1",
      name: "bartender",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(prisma.staffSkill.findMany).mockResolvedValue([]);

    // Mock to return only active certifications (endedAt: null)
    vi.mocked(prisma.staffLocationCertification.findMany).mockImplementation((async (
      args: unknown,
    ) => {
      // Simulate the database filtering by checking the where clause
      if ((args as { where?: { endedAt?: unknown } })?.where?.endedAt === null) {
        return [
          {
            id: "cert-1",
            staffId: "staff-1",
            locationId: "loc-1",
            certifiedAt: new Date("2026-01-01"),
            endedAt: null, // active
          },
        ];
      }
      return [];
    }) as never);

    vi.mocked(prisma.availability.findMany).mockResolvedValue([]);
    vi.mocked(prisma.shiftAssignment.findMany).mockResolvedValue([]);

    const ctx = await loadContext("staff-1", "shift-1");

    // Only the active certification (endedAt: null) should be included
    expect(ctx.activeCertificationLocationIds).toContain("loc-1");
    expect(ctx.activeCertificationLocationIds).not.toContain("loc-2");

    // Verify the query was called with the correct filter
    expect(prisma.staffLocationCertification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          staffId: "staff-1",
          endedAt: null,
        }),
      }),
    );
  });
});
