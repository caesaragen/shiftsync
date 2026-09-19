import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  visibleLocationScope,
  canSeeLocation,
  assertCanManageLocation,
  ForbiddenError,
  type LocationScope,
} from "./authz";

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

describe("visibleLocationScope", () => {
  it("gives admins everything without querying assignments", async () => {
    await expect(visibleLocationScope(admin)).resolves.toEqual({ scope: "all" });
    expect(prisma.managerLocation.findMany).not.toHaveBeenCalled();
  });

  it("gives managers only their assigned locations", async () => {
    vi.mocked(prisma.managerLocation.findMany).mockResolvedValue([
      { locationId: "loc1" },
      { locationId: "loc2" },
    ] as never);
    await expect(visibleLocationScope(manager)).resolves.toEqual({
      scope: "ids",
      ids: ["loc1", "loc2"],
    });
  });

  it("gives staff only locations they are actively certified for", async () => {
    vi.mocked(prisma.staffLocationCertification.findMany).mockResolvedValue([
      { locationId: "loc3" },
    ] as never);
    await expect(visibleLocationScope(staff)).resolves.toEqual({ scope: "ids", ids: ["loc3"] });
    // Ended certifications must be excluded at the query level
    expect(vi.mocked(prisma.staffLocationCertification.findMany).mock.calls[0][0]).toMatchObject({
      where: { staffId: "u3", endedAt: null },
    });
  });
});

describe("canSeeLocation", () => {
  it("returns true for any location id when scope is 'all'", () => {
    const scope: LocationScope = { scope: "all" };
    expect(canSeeLocation(scope, "loc1")).toBe(true);
    expect(canSeeLocation(scope, "anything")).toBe(true);
  });

  it("returns true for a member id when scope is 'ids'", () => {
    const scope: LocationScope = { scope: "ids", ids: ["loc1", "loc2"] };
    expect(canSeeLocation(scope, "loc1")).toBe(true);
  });

  it("returns false for a non-member id when scope is 'ids'", () => {
    const scope: LocationScope = { scope: "ids", ids: ["loc1", "loc2"] };
    expect(canSeeLocation(scope, "loc9")).toBe(false);
  });

  it("returns false for any id when scope is 'ids' with an empty list", () => {
    const scope: LocationScope = { scope: "ids", ids: [] };
    expect(canSeeLocation(scope, "loc1")).toBe(false);
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
