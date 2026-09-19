import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    staffSkill: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    staffLocationCertification: {
      upsert: vi.fn(),
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

import { prisma } from "@/lib/prisma";
import {
  assignSkill,
  removeSkill,
  certifyStaff,
  decertifyStaff,
  listStaffAssignments,
} from "./staff-assignments";

beforeEach(() => {
  vi.mocked(prisma.staffSkill.upsert).mockReset();
  vi.mocked(prisma.staffSkill.deleteMany).mockReset();
  vi.mocked(prisma.staffLocationCertification.upsert).mockReset();
  vi.mocked(prisma.staffLocationCertification.update).mockReset();
  vi.mocked(prisma.staffLocationCertification.updateMany).mockReset();
  vi.mocked(prisma.staffLocationCertification.delete).mockReset();
  vi.mocked(prisma.staffLocationCertification.deleteMany).mockReset();
  vi.mocked(prisma.user.findMany).mockReset();
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
    vi.mocked(prisma.staffLocationCertification.upsert).mockResolvedValue({} as never);

    await certifyStaff("staff1", "loc1");

    expect(prisma.staffLocationCertification.upsert).toHaveBeenCalledWith({
      where: { staffId_locationId: { staffId: "staff1", locationId: "loc1" } },
      create: { staffId: "staff1", locationId: "loc1", endedAt: null },
      update: { endedAt: null },
    });
  });

  it("clears endedAt on re-certification instead of failing on the unique constraint", async () => {
    // Simulates a row that already exists with endedAt set (a previously
    // de-certified staff member being re-certified). upsert against the
    // @@unique([staffId, locationId]) constraint must clear endedAt rather
    // than throwing P2002.
    vi.mocked(prisma.staffLocationCertification.upsert).mockResolvedValue({
      id: "cert1",
      staffId: "staff1",
      locationId: "loc1",
      endedAt: null,
    } as never);

    await expect(certifyStaff("staff1", "loc1")).resolves.toBeUndefined();

    expect(prisma.staffLocationCertification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { endedAt: null } }),
    );
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
  it("maps staff users with their skills and certifications, including ended ones", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
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
    ] as never);

    const result = await listStaffAssignments();

    expect(result).toEqual([
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
    ]);
  });
});
