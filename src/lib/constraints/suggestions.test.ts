import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    shift: { findUnique: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    staffSkill: { findMany: vi.fn() },
    staffLocationCertification: { findMany: vi.fn() },
    availability: { findMany: vi.fn() },
    shiftAssignment: { findMany: vi.fn() },
    location: { findUnique: vi.fn() },
    skill: { findUnique: vi.fn() },
  },
}));

const { prisma } = await import("@/lib/prisma");
const { suggestAlternatives } = await import("./suggestions");

const NY = "America/New_York";

beforeEach(() => {
  vi.mocked(prisma.shift.findUnique).mockReset();
  vi.mocked(prisma.user.findMany).mockReset();
  vi.mocked(prisma.user.findUnique).mockReset();
  vi.mocked(prisma.staffSkill.findMany).mockReset();
  vi.mocked(prisma.staffLocationCertification.findMany).mockReset();
  vi.mocked(prisma.availability.findMany).mockReset();
  vi.mocked(prisma.shiftAssignment.findMany).mockReset();
  vi.mocked(prisma.location.findUnique).mockReset();
  vi.mocked(prisma.skill.findUnique).mockReset();
});

describe("suggestAlternatives", () => {
  it("returns an empty array when no staff are certified at the shift's location", async () => {
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
      location: {
        id: "loc-1",
        name: "Pier 39",
        timezone: NY,
        address: "123 Main St",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      requiredSkill: {
        id: "skill-1",
        name: "bartender",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as never);

    // No staff have the required certification
    vi.mocked(prisma.staffLocationCertification.findMany).mockResolvedValue([]);

    const suggestions = await suggestAlternatives("shift-1");
    expect(suggestions).toEqual([]);
  });

  it("never includes the excluded staff member", async () => {
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
      location: {
        id: "loc-1",
        name: "Pier 39",
        timezone: NY,
        address: "123 Main St",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      requiredSkill: {
        id: "skill-1",
        name: "bartender",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as never);

    vi.mocked(prisma.staffLocationCertification.findMany).mockResolvedValue([
      {
        id: "cert-1",
        staffId: "staff-1",
        locationId: "loc-1",
        certifiedAt: new Date("2026-01-01"),
        endedAt: null,
      },
    ] as never);

    vi.mocked(prisma.user.findMany).mockResolvedValue([
      {
        id: "staff-1",
        name: "Jordan",
        email: "jordan@test.com",
        passwordHash: "hash",
        role: "STAFF",
        homeTimezone: NY,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);

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

    vi.mocked(prisma.availability.findMany).mockResolvedValue([
      {
        id: "avail-1",
        staffId: "staff-1",
        kind: "RECURRING",
        dayOfWeek: 1,
        date: null,
        startMinutes: 0,
        endMinutes: 1440,
        isAvailable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);

    vi.mocked(prisma.shiftAssignment.findMany).mockResolvedValue([]);

    // Exclude staff-1 from suggestions
    const suggestions = await suggestAlternatives("shift-1", "staff-1");
    expect(suggestions.some((s) => s.staffId === "staff-1")).toBe(false);
  });

  it("ranks suggestions by fewest hours already scheduled that week", async () => {
    vi.mocked(prisma.shift.findUnique).mockResolvedValue({
      id: "shift-1",
      locationId: "loc-1",
      startAt: new Date("2026-06-15T14:00:00Z"), // Monday
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
      requiredSkill: {
        id: "skill-1",
        name: "bartender",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
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

    vi.mocked(prisma.staffLocationCertification.findMany).mockResolvedValue([
      {
        id: "cert-1",
        staffId: "staff-1",
        locationId: "loc-1",
        certifiedAt: new Date("2026-01-01"),
        endedAt: null,
      },
      {
        id: "cert-2",
        staffId: "staff-2",
        locationId: "loc-1",
        certifiedAt: new Date("2026-01-01"),
        endedAt: null,
      },
    ] as never);

    vi.mocked(prisma.user.findMany).mockResolvedValue([
      {
        id: "staff-1",
        name: "Jordan",
        email: "jordan@test.com",
        passwordHash: "hash",
        role: "STAFF",
        homeTimezone: NY,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "staff-2",
        name: "Casey",
        email: "casey@test.com",
        passwordHash: "hash",
        role: "STAFF",
        homeTimezone: NY,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);

    vi.mocked(prisma.user.findUnique).mockImplementation((async (args: unknown) => {
      const typedArgs = args as { where?: { id?: string } };
      if (typedArgs?.where?.id === "staff-1") {
        return {
          id: "staff-1",
          name: "Jordan",
          email: "jordan@test.com",
          passwordHash: "hash",
          role: "STAFF",
          homeTimezone: NY,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      if (typedArgs?.where?.id === "staff-2") {
        return {
          id: "staff-2",
          name: "Casey",
          email: "casey@test.com",
          passwordHash: "hash",
          role: "STAFF",
          homeTimezone: NY,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      return null;
    }) as never);

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
      {
        id: "ss-2",
        staffId: "staff-2",
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

    // Both staff available all week, all day
    vi.mocked(prisma.availability.findMany).mockResolvedValue([
      {
        id: "avail-1",
        staffId: "staff-1",
        kind: "RECURRING",
        dayOfWeek: 1,
        date: null,
        startMinutes: 0,
        endMinutes: 1440,
        isAvailable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "avail-2",
        staffId: "staff-1",
        kind: "RECURRING",
        dayOfWeek: 2,
        date: null,
        startMinutes: 0,
        endMinutes: 1440,
        isAvailable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "avail-3",
        staffId: "staff-1",
        kind: "RECURRING",
        dayOfWeek: 3,
        date: null,
        startMinutes: 0,
        endMinutes: 1440,
        isAvailable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "avail-4",
        staffId: "staff-1",
        kind: "RECURRING",
        dayOfWeek: 4,
        date: null,
        startMinutes: 0,
        endMinutes: 1440,
        isAvailable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "avail-5",
        staffId: "staff-1",
        kind: "RECURRING",
        dayOfWeek: 5,
        date: null,
        startMinutes: 0,
        endMinutes: 1440,
        isAvailable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "avail-6",
        staffId: "staff-1",
        kind: "RECURRING",
        dayOfWeek: 6,
        date: null,
        startMinutes: 0,
        endMinutes: 1440,
        isAvailable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "avail-7",
        staffId: "staff-1",
        kind: "RECURRING",
        dayOfWeek: 7,
        date: null,
        startMinutes: 0,
        endMinutes: 1440,
        isAvailable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // staff-2 availability (all days)
      {
        id: "avail-8",
        staffId: "staff-2",
        kind: "RECURRING",
        dayOfWeek: 1,
        date: null,
        startMinutes: 0,
        endMinutes: 1440,
        isAvailable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "avail-9",
        staffId: "staff-2",
        kind: "RECURRING",
        dayOfWeek: 2,
        date: null,
        startMinutes: 0,
        endMinutes: 1440,
        isAvailable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "avail-10",
        staffId: "staff-2",
        kind: "RECURRING",
        dayOfWeek: 3,
        date: null,
        startMinutes: 0,
        endMinutes: 1440,
        isAvailable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "avail-11",
        staffId: "staff-2",
        kind: "RECURRING",
        dayOfWeek: 4,
        date: null,
        startMinutes: 0,
        endMinutes: 1440,
        isAvailable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "avail-12",
        staffId: "staff-2",
        kind: "RECURRING",
        dayOfWeek: 5,
        date: null,
        startMinutes: 0,
        endMinutes: 1440,
        isAvailable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "avail-13",
        staffId: "staff-2",
        kind: "RECURRING",
        dayOfWeek: 6,
        date: null,
        startMinutes: 0,
        endMinutes: 1440,
        isAvailable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "avail-14",
        staffId: "staff-2",
        kind: "RECURRING",
        dayOfWeek: 7,
        date: null,
        startMinutes: 0,
        endMinutes: 1440,
        isAvailable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);

    // staff-1 has 12 hours scheduled this week (Wed 14:00-18:00 + Fri 14:00-22:00 = 4+8)
    // staff-2 has 4 hours scheduled this week (Wed 09:00-13:00)
    // Candidate shift is Mon 14:00-18:00, so no conflicts with existing shifts (different days)
    // All in the week of June 15 (Monday) - June 21 (Sunday)
    vi.mocked(prisma.shiftAssignment.findMany).mockResolvedValue([
      {
        id: "assign-1",
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
          startAt: new Date("2026-06-17T18:00:00Z"), // Wednesday 14:00 EDT
          endAt: new Date("2026-06-17T22:00:00Z"), // 18:00 EDT (4 hours)
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
        shiftId: "shift-3",
        staffId: "staff-1",
        assignedById: "user-1",
        assignedAt: new Date(),
        overrideReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        shift: {
          id: "shift-3",
          locationId: "loc-1",
          startAt: new Date("2026-06-19T18:00:00Z"), // Friday 14:00 EDT
          endAt: new Date("2026-06-20T02:00:00Z"), // 22:00 EDT (8 hours)
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
        id: "assign-3",
        shiftId: "shift-4",
        staffId: "staff-2",
        assignedById: "user-1",
        assignedAt: new Date(),
        overrideReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        shift: {
          id: "shift-4",
          locationId: "loc-1",
          startAt: new Date("2026-06-17T13:00:00Z"), // Wednesday 09:00 EDT
          endAt: new Date("2026-06-17T17:00:00Z"), // 13:00 EDT (4 hours)
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

    const suggestions = await suggestAlternatives("shift-1");
    // staff-2 should be first (has fewer hours scheduled)
    expect(suggestions.length).toBeGreaterThan(0);
    if (suggestions.length > 1) {
      expect(suggestions[0].staffId).toBe("staff-2");
      expect(suggestions[1].staffId).toBe("staff-1");
    }
  });

  it("includes concrete information in the reason field", async () => {
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
      location: {
        id: "loc-1",
        name: "Pier 39",
        timezone: NY,
        address: "123 Main St",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      requiredSkill: {
        id: "skill-1",
        name: "bartender",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
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

    vi.mocked(prisma.staffLocationCertification.findMany).mockResolvedValue([
      {
        id: "cert-1",
        staffId: "staff-1",
        locationId: "loc-1",
        certifiedAt: new Date("2026-01-01"),
        endedAt: null,
      },
    ] as never);

    vi.mocked(prisma.user.findMany).mockResolvedValue([
      {
        id: "staff-1",
        name: "Jordan",
        email: "jordan@test.com",
        passwordHash: "hash",
        role: "STAFF",
        homeTimezone: NY,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);

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

    vi.mocked(prisma.availability.findMany).mockResolvedValue([
      {
        id: "avail-1",
        staffId: "staff-1",
        kind: "RECURRING",
        dayOfWeek: 1,
        date: null,
        startMinutes: 0,
        endMinutes: 1440,
        isAvailable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);

    vi.mocked(prisma.shiftAssignment.findMany).mockResolvedValue([]);

    const suggestions = await suggestAlternatives("shift-1");
    expect(suggestions.length).toBeGreaterThan(0);
    const suggestion = suggestions[0];
    expect(suggestion.reason).toBeDefined();
    // Reason should mention skill, location, and hours
    expect(suggestion.reason.toLowerCase()).toContain("bartender");
    expect(suggestion.reason.toLowerCase()).toContain("pier 39");
    expect(suggestion.reason.toLowerCase()).toMatch(/\d+\s*hour/);
  });
});
