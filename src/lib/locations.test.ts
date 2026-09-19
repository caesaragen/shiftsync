import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    location: {
      create: vi.fn(),
      update: vi.fn(),
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
import { isValidTimezone, createLocation, updateLocation, listLocations } from "./locations";

const admin = { id: "u1", name: "A", email: "a@x.test", role: "ADMIN" as const };
const manager = { id: "u2", name: "M", email: "m@x.test", role: "MANAGER" as const };

beforeEach(() => {
  vi.mocked(prisma.location.create).mockReset();
  vi.mocked(prisma.location.update).mockReset();
  vi.mocked(prisma.location.findMany).mockReset();
  vi.mocked(visibleLocationScope).mockReset();
});

describe("isValidTimezone", () => {
  it("accepts valid IANA timezones", () => {
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("America/Los_Angeles")).toBe(true);
  });

  it("rejects invalid or empty timezones", () => {
    expect(isValidTimezone("Not/AZone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});

describe("createLocation", () => {
  it("rejects an invalid timezone before writing", async () => {
    await expect(createLocation({ name: "Bad", timezone: "Not/AZone" })).rejects.toThrow(
      /timezone/i,
    );
    expect(prisma.location.create).not.toHaveBeenCalled();
  });

  it("creates a location with a valid timezone", async () => {
    vi.mocked(prisma.location.create).mockResolvedValue({
      id: "loc1",
      name: "Downtown",
      timezone: "America/New_York",
      address: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    await expect(
      createLocation({ name: "Downtown", timezone: "America/New_York" }),
    ).resolves.toMatchObject({ id: "loc1", name: "Downtown" });
    expect(prisma.location.create).toHaveBeenCalledWith({
      data: { name: "Downtown", timezone: "America/New_York", address: undefined },
    });
  });
});

describe("updateLocation", () => {
  it("rejects an invalid timezone before writing", async () => {
    await expect(updateLocation("loc1", { timezone: "Not/AZone" })).rejects.toThrow(/timezone/i);
    expect(prisma.location.update).not.toHaveBeenCalled();
  });

  it("allows updates without a timezone change", async () => {
    vi.mocked(prisma.location.update).mockResolvedValue({
      id: "loc1",
      name: "New Name",
      timezone: "America/New_York",
      address: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    await expect(updateLocation("loc1", { name: "New Name" })).resolves.toMatchObject({
      name: "New Name",
    });
    expect(prisma.location.update).toHaveBeenCalledWith({
      where: { id: "loc1" },
      data: { name: "New Name" },
    });
  });
});

describe("listLocations", () => {
  it("returns everything for an admin (no filter)", async () => {
    vi.mocked(visibleLocationScope).mockResolvedValue({ scope: "all" });
    vi.mocked(prisma.location.findMany).mockResolvedValue([{ id: "loc1" }] as never);

    await expect(listLocations(admin)).resolves.toEqual([{ id: "loc1" }]);
    expect(prisma.location.findMany).toHaveBeenCalledWith({});
  });

  it("filters by id for a manager", async () => {
    vi.mocked(visibleLocationScope).mockResolvedValue({ scope: "ids", ids: ["loc1", "loc2"] });
    vi.mocked(prisma.location.findMany).mockResolvedValue([{ id: "loc1" }] as never);

    await expect(listLocations(manager)).resolves.toEqual([{ id: "loc1" }]);
    expect(prisma.location.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["loc1", "loc2"] } },
    });
  });
});
