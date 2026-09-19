import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    shift: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    location: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    skill: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return {
    ...actual,
    assertCanManageLocation: vi.fn(),
    visibleLocationScope: vi.fn(),
  };
});

vi.mock("@/lib/time/zones", async () => {
  const actual = await vi.importActual<typeof import("@/lib/time/zones")>("@/lib/time/zones");
  return actual;
});

import { prisma } from "@/lib/prisma";
import { assertCanManageLocation, visibleLocationScope, ForbiddenError } from "@/lib/authz";
import {
  EDIT_CUTOFF_HOURS,
  isPremiumShift,
  isWithinEditCutoff,
  listWeekShifts,
  getShift,
  createShift,
  publishWeek,
  unpublishWeek,
} from "./shifts";

const manager = { id: "u2", name: "M", email: "m@x.test", role: "MANAGER" as const };
const staff = { id: "u3", name: "S", email: "s@x.test", role: "STAFF" as const };

const eastLocation = {
  id: "loc1",
  name: "Downtown",
  timezone: "America/New_York",
  address: "123 Main",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const skill = {
  id: "sk1",
  name: "Bartender",
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.mocked(prisma.shift.create).mockReset();
  vi.mocked(prisma.shift.findMany).mockReset();
  vi.mocked(prisma.shift.findUnique).mockReset();
  vi.mocked(prisma.shift.update).mockReset();
  vi.mocked(prisma.shift.updateMany).mockReset();
  vi.mocked(prisma.location.findUnique).mockReset();
  vi.mocked(prisma.location.findUniqueOrThrow).mockReset();
  vi.mocked(prisma.skill.findUnique).mockReset();
  vi.mocked(assertCanManageLocation).mockReset();
  vi.mocked(visibleLocationScope).mockReset();
});

describe("EDIT_CUTOFF_HOURS", () => {
  it("is 48", () => {
    expect(EDIT_CUTOFF_HOURS).toBe(48);
  });
});

describe("isPremiumShift", () => {
  it("returns true for Friday at 17:00 in location timezone", () => {
    // Friday, Sep 19, 2025 17:00 EDT (Eastern)
    const fridayStart = new Date("2025-09-19T21:00Z"); // 21:00 UTC = 17:00 EDT
    expect(isPremiumShift(fridayStart, "America/New_York")).toBe(true);
  });

  it("returns true for Saturday at 17:00 in location timezone", () => {
    // Saturday, Sep 20, 2025 17:00 EDT
    const saturdayStart = new Date("2025-09-20T21:00Z"); // 21:00 UTC = 17:00 EDT
    expect(isPremiumShift(saturdayStart, "America/New_York")).toBe(true);
  });

  it("returns false for Sunday at 17:00 in location timezone", () => {
    // Sunday, Sep 21, 2025 17:00 EDT
    const sundayStart = new Date("2025-09-21T21:00Z"); // 21:00 UTC = 17:00 EDT
    expect(isPremiumShift(sundayStart, "America/New_York")).toBe(false);
  });

  it("returns false for Friday before 17:00 in location timezone", () => {
    // Friday, Sep 19, 2025 16:59 EDT
    const fridayEarly = new Date("2025-09-19T20:59Z"); // 20:59 UTC = 16:59 EDT
    expect(isPremiumShift(fridayEarly, "America/New_York")).toBe(false);
  });

  it("respects the location's timezone, not UTC", () => {
    // Friday, Sep 19, 2025 23:59 PDT (Pacific) = Saturday 06:59 EDT (Eastern)
    // This is premium in Pacific (Fri >= 17:00) but not in Eastern (Sat 06:59, hour < 17)
    const fridayLatePacific = new Date("2025-09-20T06:59Z"); // 06:59 UTC = 23:59 PDT (Fri) = 06:59 EDT (Sat, but hour < 17)
    expect(isPremiumShift(fridayLatePacific, "America/Los_Angeles")).toBe(true);
    expect(isPremiumShift(fridayLatePacific, "America/New_York")).toBe(false);
  });

  it("returns false for Monday-Thursday regardless of hour", () => {
    // Monday at 20:00 EDT
    const mondayStart = new Date("2025-09-15T00:00Z");
    expect(isPremiumShift(mondayStart, "America/New_York")).toBe(false);

    // Wednesday at 22:00 EDT
    const wednesdayStart = new Date("2025-09-17T02:00Z");
    expect(isPremiumShift(wednesdayStart, "America/New_York")).toBe(false);
  });
});

describe("isWithinEditCutoff", () => {
  const now = new Date("2025-09-19T12:00:00Z");

  it("returns false for DRAFT shifts regardless of time", () => {
    const draftShift = {
      status: "DRAFT" as const,
      startAt: new Date("2025-09-21T00:00:00Z"), // 12 hours away
    };
    expect(isWithinEditCutoff(draftShift, now)).toBe(false);
  });

  it("returns true for PUBLISHED shifts starting exactly 48 hours from now", () => {
    const publishedShift = {
      status: "PUBLISHED" as const,
      startAt: new Date("2025-09-21T12:00:00Z"), // exactly 48 hours
    };
    expect(isWithinEditCutoff(publishedShift, now)).toBe(true);
  });

  it("returns true for PUBLISHED shifts starting less than 48 hours from now", () => {
    const publishedShift = {
      status: "PUBLISHED" as const,
      startAt: new Date("2025-09-21T11:00:00Z"), // 47 hours away
    };
    expect(isWithinEditCutoff(publishedShift, now)).toBe(true);
  });

  it("returns false for PUBLISHED shifts starting more than 48 hours from now", () => {
    const publishedShift = {
      status: "PUBLISHED" as const,
      startAt: new Date("2025-09-21T13:00:00Z"), // 49 hours away
    };
    expect(isWithinEditCutoff(publishedShift, now)).toBe(false);
  });

  it("returns false for PUBLISHED shifts in the past", () => {
    const publishedShift = {
      status: "PUBLISHED" as const,
      startAt: new Date("2025-09-19T00:00:00Z"), // in the past
    };
    expect(isWithinEditCutoff(publishedShift, now)).toBe(false);
  });

  it("returns false at 48 hours and 1 second past cutoff", () => {
    const publishedShift = {
      status: "PUBLISHED" as const,
      startAt: new Date(now.getTime() + 48 * 3600 * 1000 + 1000), // 48h + 1s
    };
    expect(isWithinEditCutoff(publishedShift, now)).toBe(false);
  });

  it("returns true at 48 hours minus 1 second (inside cutoff)", () => {
    const publishedShift = {
      status: "PUBLISHED" as const,
      startAt: new Date(now.getTime() + 48 * 3600 * 1000 - 1000), // 48h - 1s
    };
    expect(isWithinEditCutoff(publishedShift, now)).toBe(true);
  });
});

describe("createShift", () => {
  const startAt = new Date("2025-09-20T21:00Z"); // Saturday 17:00 EDT
  const endAt = new Date("2025-09-21T01:00Z"); // 20:00 EDT same night

  it("calls assertCanManageLocation before any database operation", async () => {
    vi.mocked(assertCanManageLocation).mockRejectedValue(new ForbiddenError());

    await expect(
      createShift(manager, {
        locationId: "loc1",
        startAt,
        endAt,
        requiredSkillId: "sk1",
        headcount: 2,
      }),
    ).rejects.toThrow(ForbiddenError);
    expect(vi.mocked(assertCanManageLocation)).toHaveBeenCalledWith(manager, "loc1");
    expect(prisma.shift.create).not.toHaveBeenCalled();
  });

  it("rejects endAt <= startAt without writing", async () => {
    vi.mocked(assertCanManageLocation).mockResolvedValue(undefined);

    const sameTime = new Date(startAt);
    await expect(
      createShift(manager, {
        locationId: "loc1",
        startAt,
        endAt: sameTime,
        requiredSkillId: "sk1",
        headcount: 2,
      }),
    ).rejects.toThrow(/end.*before.*start|end time must be after start time/i);
    expect(prisma.shift.create).not.toHaveBeenCalled();

    const earlierEnd = new Date(startAt.getTime() - 1000);
    await expect(
      createShift(manager, {
        locationId: "loc1",
        startAt,
        endAt: earlierEnd,
        requiredSkillId: "sk1",
        headcount: 2,
      }),
    ).rejects.toThrow(/end.*before.*start|end time must be after start time/i);
    expect(prisma.shift.create).not.toHaveBeenCalled();
  });

  it("rejects headcount < 1 without writing", async () => {
    vi.mocked(assertCanManageLocation).mockResolvedValue(undefined);

    await expect(
      createShift(manager, {
        locationId: "loc1",
        startAt,
        endAt,
        requiredSkillId: "sk1",
        headcount: 0,
      }),
    ).rejects.toThrow(/headcount|must be at least 1/i);
    expect(prisma.shift.create).not.toHaveBeenCalled();

    await expect(
      createShift(manager, {
        locationId: "loc1",
        startAt,
        endAt,
        requiredSkillId: "sk1",
        headcount: -1,
      }),
    ).rejects.toThrow(/headcount|must be at least 1/i);
    expect(prisma.shift.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown location without writing", async () => {
    vi.mocked(assertCanManageLocation).mockResolvedValue(undefined);
    vi.mocked(prisma.location.findUnique).mockResolvedValue(null);

    await expect(
      createShift(manager, {
        locationId: "unknown",
        startAt,
        endAt,
        requiredSkillId: "sk1",
        headcount: 2,
      }),
    ).rejects.toThrow(/location|not found|does not exist/i);
    expect(prisma.shift.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown skill without writing", async () => {
    vi.mocked(assertCanManageLocation).mockResolvedValue(undefined);
    vi.mocked(prisma.location.findUnique).mockResolvedValue(eastLocation as never);
    vi.mocked(prisma.skill.findUnique).mockResolvedValue(null);

    await expect(
      createShift(manager, {
        locationId: "loc1",
        startAt,
        endAt,
        requiredSkillId: "unknown",
        headcount: 2,
      }),
    ).rejects.toThrow(/skill|not found|does not exist/i);
    expect(prisma.shift.create).not.toHaveBeenCalled();
  });

  it("creates a shift with valid inputs", async () => {
    vi.mocked(assertCanManageLocation).mockResolvedValue(undefined);
    vi.mocked(prisma.location.findUnique).mockResolvedValue(eastLocation as never);
    vi.mocked(prisma.skill.findUnique).mockResolvedValue(skill as never);

    const createdShift = {
      id: "sh1",
      locationId: "loc1",
      startAt,
      endAt,
      requiredSkillId: "sk1",
      headcount: 2,
      status: "DRAFT" as const,
      notes: null,
      createdById: "u2",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.shift.create).mockResolvedValue(createdShift as never);

    const result = await createShift(manager, {
      locationId: "loc1",
      startAt,
      endAt,
      requiredSkillId: "sk1",
      headcount: 2,
      notes: undefined,
    });

    expect(result).toEqual(createdShift);
    expect(prisma.shift.create).toHaveBeenCalledWith({
      data: {
        locationId: "loc1",
        startAt,
        endAt,
        requiredSkillId: "sk1",
        headcount: 2,
        notes: undefined,
        createdById: "u2",
      },
    });
  });

  it("allows overnight shifts (endAt on following calendar day)", async () => {
    vi.mocked(assertCanManageLocation).mockResolvedValue(undefined);
    vi.mocked(prisma.location.findUnique).mockResolvedValue(eastLocation as never);
    vi.mocked(prisma.skill.findUnique).mockResolvedValue(skill as never);

    // 22:00 Fri to 06:00 Sat
    const fridayNight = new Date("2025-09-19T02:00Z"); // 22:00 EDT Fri
    const saturdayMorning = new Date("2025-09-20T10:00Z"); // 06:00 EDT Sat

    const createdShift = {
      id: "sh2",
      locationId: "loc1",
      startAt: fridayNight,
      endAt: saturdayMorning,
      requiredSkillId: "sk1",
      headcount: 1,
      status: "DRAFT" as const,
      notes: null,
      createdById: "u2",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.shift.create).mockResolvedValue(createdShift as never);

    const result = await createShift(manager, {
      locationId: "loc1",
      startAt: fridayNight,
      endAt: saturdayMorning,
      requiredSkillId: "sk1",
      headcount: 1,
    });

    expect(result).toEqual(createdShift);
    expect(prisma.shift.create).toHaveBeenCalled();
  });
});

describe("listWeekShifts", () => {
  it("denies a manager without access to the location", async () => {
    vi.mocked(visibleLocationScope).mockResolvedValue({ scope: "ids", ids: ["loc-other"] });

    const weekOf = new Date("2025-09-19T00:00Z");
    await expect(listWeekShifts(manager, "loc1", weekOf)).rejects.toThrow();
    expect(prisma.shift.findMany).not.toHaveBeenCalled();
  });

  it("allows a staff member certified at the location to read", async () => {
    vi.mocked(visibleLocationScope).mockResolvedValue({ scope: "ids", ids: ["loc1"] });
    vi.mocked(prisma.location.findUniqueOrThrow).mockResolvedValue({
      timezone: "America/New_York",
    } as never);

    const shiftWithDetail = {
      id: "sh1",
      locationId: "loc1",
      startAt: new Date("2025-09-20T21:00Z"),
      endAt: new Date("2025-09-21T01:00Z"),
      requiredSkillId: "sk1",
      headcount: 2,
      status: "DRAFT" as const,
      notes: null,
      createdById: "u2",
      createdAt: new Date(),
      updatedAt: new Date(),
      location: eastLocation,
      requiredSkill: skill,
      assignments: [],
    };

    vi.mocked(prisma.shift.findMany).mockResolvedValue([shiftWithDetail] as never);

    const weekOf = new Date("2025-09-19T00:00Z");
    const result = await listWeekShifts(staff, "loc1", weekOf);

    expect(result).toEqual([shiftWithDetail]);
    expect(prisma.shift.findMany).toHaveBeenCalled();
  });

  it("denies a staff member not certified at the location", async () => {
    vi.mocked(visibleLocationScope).mockResolvedValue({ scope: "ids", ids: ["loc-other"] });

    const weekOf = new Date("2025-09-19T00:00Z");
    await expect(listWeekShifts(staff, "loc1", weekOf)).rejects.toThrow();
    expect(prisma.shift.findMany).not.toHaveBeenCalled();
  });

  it("uses location timezone for week boundaries (Pacific timezone)", async () => {
    // For a Pacific location, Monday should start Sunday 00:00 UTC (Sunday 16:00 PDT = Monday 00:00 PDT)
    // Use a concrete date: Monday Sep 22, 2025 00:00 PDT = Sunday Sep 21, 2025 23:00 UTC
    // A shift on Sunday Sep 21, 2025 23:30 PDT (Monday Sep 22 07:30 UTC) should be in the Monday-start week
    vi.mocked(visibleLocationScope).mockResolvedValue({ scope: "ids", ids: ["loc2"] });
    vi.mocked(prisma.location.findUniqueOrThrow).mockResolvedValue({
      timezone: "America/Los_Angeles",
    } as never);
    vi.mocked(prisma.shift.findMany).mockResolvedValue([]);

    // Pass in a date that's Sunday in Pacific time
    const weekOf = new Date("2025-09-21T23:30:00Z"); // Sunday 16:30 PDT
    await listWeekShifts(staff, "loc2", weekOf);

    // Verify the query used Pacific timezone boundaries, not UTC
    const callArgs = vi.mocked(prisma.shift.findMany).mock.calls[0][0];
    // Monday 00:00 PDT = Monday 07:00 UTC = 2025-09-22T07:00:00Z
    expect(callArgs?.where?.locationId).toBe("loc2");
    expect(callArgs?.where?.startAt).toBeDefined();
  });
});

describe("getShift", () => {
  it("denies a manager without access to the shift's location", async () => {
    const mockShift = {
      id: "sh1",
      locationId: "loc1",
      startAt: new Date(),
      endAt: new Date(),
      requiredSkillId: "sk1",
      headcount: 1,
      status: "DRAFT" as const,
      notes: null,
      createdById: "u2",
      createdAt: new Date(),
      updatedAt: new Date(),
      location: eastLocation,
      requiredSkill: skill,
      assignments: [],
    };
    vi.mocked(prisma.shift.findUnique).mockResolvedValue(mockShift as never);
    vi.mocked(visibleLocationScope).mockResolvedValue({ scope: "ids", ids: ["loc-other"] });

    await expect(getShift(manager, "sh1")).rejects.toThrow();
  });

  it("allows a staff member certified at the shift's location to read", async () => {
    const shiftWithDetail = {
      id: "sh1",
      locationId: "loc1",
      startAt: new Date("2025-09-20T21:00Z"),
      endAt: new Date("2025-09-21T01:00Z"),
      requiredSkillId: "sk1",
      headcount: 2,
      status: "DRAFT" as const,
      notes: null,
      createdById: "u2",
      createdAt: new Date(),
      updatedAt: new Date(),
      location: eastLocation,
      requiredSkill: skill,
      assignments: [],
    };

    vi.mocked(prisma.shift.findUnique).mockResolvedValue(shiftWithDetail as never);
    vi.mocked(visibleLocationScope).mockResolvedValue({ scope: "ids", ids: ["loc1"] });

    const result = await getShift(staff, "sh1");

    expect(result).toEqual(shiftWithDetail);
    expect(prisma.shift.findUnique).toHaveBeenCalled();
  });
});

describe("publishWeek", () => {
  it("calls assertCanManageLocation for authorization", async () => {
    vi.mocked(assertCanManageLocation).mockRejectedValue(new ForbiddenError());

    const weekOf = new Date("2025-09-19T00:00Z");
    await expect(publishWeek(manager, "loc1", weekOf)).rejects.toThrow(ForbiddenError);
    expect(vi.mocked(assertCanManageLocation)).toHaveBeenCalledWith(manager, "loc1");
  });

  it("publishes shifts in the Monday-start week using location timezone", async () => {
    vi.mocked(assertCanManageLocation).mockResolvedValue(undefined);
    vi.mocked(prisma.location.findUniqueOrThrow).mockResolvedValue({
      timezone: "America/New_York",
    } as never);
    vi.mocked(prisma.shift.updateMany).mockResolvedValue({ count: 3 });

    const weekOf = new Date("2025-09-19T00:00Z"); // Friday
    const result = await publishWeek(manager, "loc1", weekOf);

    expect(result).toEqual({ count: 3 });
    expect(prisma.shift.updateMany).toHaveBeenCalled();
  });
});

describe("unpublishWeek", () => {
  it("calls assertCanManageLocation for authorization", async () => {
    vi.mocked(assertCanManageLocation).mockRejectedValue(new ForbiddenError());

    const weekOf = new Date("2025-09-19T00:00Z");
    await expect(unpublishWeek(manager, "loc1", weekOf)).rejects.toThrow(ForbiddenError);
    expect(vi.mocked(assertCanManageLocation)).toHaveBeenCalledWith(manager, "loc1");
  });

  it("refuses to unpublish if any shift is within the cutoff", async () => {
    vi.mocked(assertCanManageLocation).mockResolvedValue(undefined);
    vi.mocked(prisma.location.findUniqueOrThrow).mockResolvedValue({
      timezone: "America/New_York",
    } as never);

    // Mock a shift within the cutoff
    const withinCutoffShift = {
      id: "sh1",
      locationId: "loc1",
      startAt: new Date(Date.now() + 24 * 3600 * 1000), // 24 hours from now
      endAt: new Date(Date.now() + 28 * 3600 * 1000),
      requiredSkillId: "sk1",
      headcount: 1,
      status: "PUBLISHED" as const,
      notes: null,
      createdById: "u2",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.shift.findMany).mockResolvedValue([withinCutoffShift] as never);

    const weekOf = new Date();
    await expect(unpublishWeek(manager, "loc1", weekOf)).rejects.toThrow(/48.*hours|cutoff/i);
    // Should not call updateMany if any shift is within cutoff
    expect(prisma.shift.updateMany).not.toHaveBeenCalled();
  });

  it("unpublishes shifts when none are within the cutoff", async () => {
    vi.mocked(assertCanManageLocation).mockResolvedValue(undefined);
    vi.mocked(prisma.location.findUniqueOrThrow).mockResolvedValue({
      timezone: "America/New_York",
    } as never);

    // Mock a shift outside the cutoff
    const outsideCutoffShift = {
      id: "sh1",
      locationId: "loc1",
      startAt: new Date(Date.now() + 72 * 3600 * 1000), // 72 hours from now
      endAt: new Date(Date.now() + 76 * 3600 * 1000),
      requiredSkillId: "sk1",
      headcount: 1,
      status: "PUBLISHED" as const,
      notes: null,
      createdById: "u2",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.shift.findMany).mockResolvedValue([outsideCutoffShift] as never);
    vi.mocked(prisma.shift.updateMany).mockResolvedValue({ count: 1 });

    const weekOf = new Date();
    const result = await unpublishWeek(manager, "loc1", weekOf);

    expect(result).toEqual({ count: 1 });
    expect(prisma.shift.updateMany).toHaveBeenCalled();
  });
});
