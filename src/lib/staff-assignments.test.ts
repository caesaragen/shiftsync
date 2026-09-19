import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    staffSkill: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    staffLocationCertification: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return {
    ...actual,
    visibleLocationScope: vi.fn(),
  };
});

import { prisma } from "@/lib/prisma";
import { visibleLocationScope } from "@/lib/authz";
import {
  assignSkill,
  removeSkill,
  certifyStaff,
  decertifyStaff,
  listStaffAssignments,
} from "./staff-assignments";

const admin = { id: "u1", name: "A", email: "a@x.test", role: "ADMIN" as const };
const manager = { id: "u2", name: "M", email: "m@x.test", role: "MANAGER" as const };
const staff = { id: "u3", name: "S", email: "s@x.test", role: "STAFF" as const };

beforeEach(() => {
  vi.mocked(prisma.staffSkill.upsert).mockReset();
  vi.mocked(prisma.staffSkill.deleteMany).mockReset();
  vi.mocked(prisma.staffLocationCertification.findFirst).mockReset();
  vi.mocked(prisma.staffLocationCertification.create).mockReset();
  vi.mocked(prisma.staffLocationCertification.update).mockReset();
  vi.mocked(prisma.staffLocationCertification.updateMany).mockReset();
  vi.mocked(prisma.staffLocationCertification.delete).mockReset();
  vi.mocked(prisma.staffLocationCertification.deleteMany).mockReset();
  vi.mocked(prisma.user.findMany).mockReset();
  vi.mocked(visibleLocationScope).mockReset();
});

describe("decertifyStaff", () => {
  it("performs an UPDATE setting endedAt, and never a DELETE", async () => {
    vi.mocked(prisma.staffLocationCertification.updateMany).mockResolvedValue({
      count: 1,
    } as never);

    await decertifyStaff("staff1", "loc1");

    expect(prisma.staffLocationCertification.updateMany).toHaveBeenCalledWith({
      where: { staffId: "staff1", locationId: "loc1", endedAt: null },
      data: { endedAt: expect.any(Date) },
    });
    // The behavior that matters most: de-certification is a soft state
    // change (spec §5 decision 1). A regression to a hard delete must fail
    // this test even though the happy-path assertion above would still pass.
    expect(prisma.staffLocationCertification.delete).not.toHaveBeenCalled();
    expect(prisma.staffLocationCertification.deleteMany).not.toHaveBeenCalled();
  });
});

describe("certifyStaff", () => {
  it("creates a new certification with endedAt null when none exists", async () => {
    vi.mocked(prisma.staffLocationCertification.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.staffLocationCertification.create).mockResolvedValue({} as never);

    await certifyStaff("staff1", "loc1");

    expect(prisma.staffLocationCertification.findFirst).toHaveBeenCalledWith({
      where: { staffId: "staff1", locationId: "loc1", endedAt: null },
    });
    expect(prisma.staffLocationCertification.create).toHaveBeenCalledWith({
      data: { staffId: "staff1", locationId: "loc1", endedAt: null },
    });
  });

  it("is a no-op when an active certification already exists", async () => {
    vi.mocked(prisma.staffLocationCertification.findFirst).mockResolvedValue({
      id: "cert1",
      staffId: "staff1",
      locationId: "loc1",
      endedAt: null,
    } as never);

    await expect(certifyStaff("staff1", "loc1")).resolves.toBeUndefined();

    expect(prisma.staffLocationCertification.create).not.toHaveBeenCalled();
  });

  it("creates a NEW period row on re-certification, leaving the ended row untouched", async () => {
    // Simulates a staff member certified Jan 1, de-certified Jun 1 (a row
    // with endedAt set, and preserved), then re-certified Sep 1. There is
    // no currently-active row (findFirst with endedAt: null finds nothing),
    // so this must create a second, independent row rather than reviving
    // or overwriting the ended one — the Jun de-certification event, and
    // the five-month gap it represents, must remain in the database.
    vi.mocked(prisma.staffLocationCertification.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.staffLocationCertification.create).mockResolvedValue({
      id: "cert2",
      staffId: "staff1",
      locationId: "loc1",
      certifiedAt: new Date("2026-09-01T00:00:00Z"),
      endedAt: null,
    } as never);

    await expect(certifyStaff("staff1", "loc1")).resolves.toBeUndefined();

    expect(prisma.staffLocationCertification.create).toHaveBeenCalledWith({
      data: { staffId: "staff1", locationId: "loc1", endedAt: null },
    });
    // The old, ended row must never be touched by re-certification.
    expect(prisma.staffLocationCertification.update).not.toHaveBeenCalled();
    expect(prisma.staffLocationCertification.updateMany).not.toHaveBeenCalled();
  });
});

describe("assignSkill", () => {
  it("is idempotent — assigning an already-held skill does not throw", async () => {
    vi.mocked(prisma.staffSkill.upsert).mockResolvedValue({} as never);

    await expect(assignSkill("staff1", "skill1")).resolves.toBeUndefined();
    await expect(assignSkill("staff1", "skill1")).resolves.toBeUndefined();

    expect(prisma.staffSkill.upsert).toHaveBeenCalledWith({
      where: { staffId_skillId: { staffId: "staff1", skillId: "skill1" } },
      create: { staffId: "staff1", skillId: "skill1" },
      update: {},
    });
  });
});

describe("removeSkill", () => {
  it("removes an assigned skill without throwing if already absent", async () => {
    vi.mocked(prisma.staffSkill.deleteMany).mockResolvedValue({ count: 0 } as never);

    await expect(removeSkill("staff1", "skill1")).resolves.toBeUndefined();
    expect(prisma.staffSkill.deleteMany).toHaveBeenCalledWith({
      where: { staffId: "staff1", skillId: "skill1" },
    });
  });
});

describe("listStaffAssignments", () => {
  const rows = [
    {
      id: "staff1",
      name: "Sam Staff",
      email: "sam@coastaleats.test",
      staffSkills: [{ skill: { id: "skill1", name: "Bartending" } }],
      certifications: [
        {
          id: "cert1",
          locationId: "loc1",
          location: { name: "Downtown" },
          certifiedAt: new Date("2026-01-01T00:00:00Z"),
          endedAt: null,
        },
        {
          id: "cert2",
          locationId: "loc2",
          location: { name: "Uptown" },
          certifiedAt: new Date("2025-01-01T00:00:00Z"),
          endedAt: new Date("2026-02-01T00:00:00Z"),
        },
      ],
    },
  ];

  const expectedMapped = [
    {
      id: "staff1",
      name: "Sam Staff",
      email: "sam@coastaleats.test",
      skills: [{ id: "skill1", name: "Bartending" }],
      certifications: [
        {
          id: "cert1",
          locationId: "loc1",
          locationName: "Downtown",
          certifiedAt: new Date("2026-01-01T00:00:00Z"),
          endedAt: null,
        },
        {
          id: "cert2",
          locationId: "loc2",
          locationName: "Uptown",
          certifiedAt: new Date("2025-01-01T00:00:00Z"),
          endedAt: new Date("2026-02-01T00:00:00Z"),
        },
      ],
    },
  ];

  it("maps staff users with their skills and certifications, including ended ones", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue(rows as never);

    const result = await listStaffAssignments(admin);

    expect(result).toEqual(expectedMapped);
  });

  it("returns every staff member for an ADMIN, unfiltered", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue(rows as never);

    await listStaffAssignments(admin);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "STAFF" } }),
    );
    expect(visibleLocationScope).not.toHaveBeenCalled();
  });

  it("scopes to staff certified at the manager's locations", async () => {
    vi.mocked(visibleLocationScope).mockResolvedValue({ scope: "ids", ids: ["loc1", "loc2"] });
    vi.mocked(prisma.user.findMany).mockResolvedValue(rows as never);

    await listStaffAssignments(manager);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          role: "STAFF",
          certifications: { some: { locationId: { in: ["loc1", "loc2"] } } },
        },
      }),
    );
  });

  it("scopes to only the staff member's own record for STAFF — never their coworkers'", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue(rows as never);

    await listStaffAssignments(staff);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "STAFF", id: staff.id } }),
    );
    // STAFF scoping is by identity, not by visibleLocationScope's "my
    // active locations" — using that would leak every OTHER staff member
    // certified at the same location.
    expect(visibleLocationScope).not.toHaveBeenCalled();
  });
});
