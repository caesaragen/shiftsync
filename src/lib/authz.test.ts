import { describe, it, expect, vi, beforeEach } from "vitest";
import { visibleLocationIds, assertCanManageLocation, ForbiddenError } from "./authz";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    managerLocation: { findMany: vi.fn() },
    staffLocationCertification: { findMany: vi.fn() },
  },
}));

const { prisma } = await import("@/lib/prisma");

const admin = { id: "u1", name: "A", email: "a@x.test", role: "ADMIN" as const };
const manager = { id: "u2", name: "M", email: "m@x.test", role: "MANAGER" as const };
const staff = { id: "u3", name: "S", email: "s@x.test", role: "STAFF" as const };

beforeEach(() => {
  vi.mocked(prisma.managerLocation.findMany).mockReset();
  vi.mocked(prisma.staffLocationCertification.findMany).mockReset();
});

describe("visibleLocationIds", () => {
  it("gives admins everything without querying assignments", async () => {
    await expect(visibleLocationIds(admin)).resolves.toBe("ALL");
    expect(prisma.managerLocation.findMany).not.toHaveBeenCalled();
  });

  it("gives managers only their assigned locations", async () => {
    vi.mocked(prisma.managerLocation.findMany).mockResolvedValue([
      { locationId: "loc1" },
      { locationId: "loc2" },
    ] as never);
    await expect(visibleLocationIds(manager)).resolves.toEqual(["loc1", "loc2"]);
  });

  it("gives staff only locations they are actively certified for", async () => {
    vi.mocked(prisma.staffLocationCertification.findMany).mockResolvedValue([
      { locationId: "loc3" },
    ] as never);
    await expect(visibleLocationIds(staff)).resolves.toEqual(["loc3"]);
    // Ended certifications must be excluded at the query level
    expect(vi.mocked(prisma.staffLocationCertification.findMany).mock.calls[0][0]).toMatchObject({
      where: { staffId: "u3", endedAt: null },
    });
  });
});

describe("assertCanManageLocation", () => {
  it("allows an admin anywhere", async () => {
    await expect(assertCanManageLocation(admin, "anything")).resolves.toBeUndefined();
  });

  it("allows a manager at an assigned location", async () => {
    vi.mocked(prisma.managerLocation.findMany).mockResolvedValue([{ locationId: "loc1" }] as never);
    await expect(assertCanManageLocation(manager, "loc1")).resolves.toBeUndefined();
  });

  it("rejects a manager at an unassigned location", async () => {
    vi.mocked(prisma.managerLocation.findMany).mockResolvedValue([{ locationId: "loc1" }] as never);
    await expect(assertCanManageLocation(manager, "loc9")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects staff outright", async () => {
    vi.mocked(prisma.staffLocationCertification.findMany).mockResolvedValue([] as never);
    await expect(assertCanManageLocation(staff, "loc1")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
