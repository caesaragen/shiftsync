import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    availability: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  listMyAvailability,
  addRecurringWindow,
  addExceptionWindow,
  deleteAvailabilityRow,
} from "./staff-availability";

beforeEach(() => {
  vi.mocked(prisma.availability.findMany).mockReset();
  vi.mocked(prisma.availability.create).mockReset();
  vi.mocked(prisma.availability.deleteMany).mockReset();
});

describe("listMyAvailability", () => {
  it("queries rows scoped to the given staffId only", async () => {
    vi.mocked(prisma.availability.findMany).mockResolvedValue([]);
    await listMyAvailability("staff-1");
    expect(prisma.availability.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { staffId: "staff-1" } }),
    );
  });
});

describe("addRecurringWindow", () => {
  it("creates a RECURRING row, always isAvailable: true", async () => {
    vi.mocked(prisma.availability.create).mockResolvedValue({} as never);
    await addRecurringWindow("staff-1", { dayOfWeek: 2, startMinutes: 540, endMinutes: 1020 });
    expect(prisma.availability.create).toHaveBeenCalledWith({
      data: {
        staffId: "staff-1",
        kind: "RECURRING",
        dayOfWeek: 2,
        startMinutes: 540,
        endMinutes: 1020,
        isAvailable: true,
      },
    });
  });

  it.each([0, 8, 1.5, NaN])("rejects an out-of-range dayOfWeek (%s)", async (dayOfWeek) => {
    await expect(
      addRecurringWindow("staff-1", { dayOfWeek, startMinutes: 0, endMinutes: 60 }),
    ).rejects.toThrow();
    expect(prisma.availability.create).not.toHaveBeenCalled();
  });

  it("rejects when end is not after start", async () => {
    await expect(
      addRecurringWindow("staff-1", { dayOfWeek: 1, startMinutes: 600, endMinutes: 600 }),
    ).rejects.toThrow(/after/i);
    await expect(
      addRecurringWindow("staff-1", { dayOfWeek: 1, startMinutes: 600, endMinutes: 300 }),
    ).rejects.toThrow(/after/i);
  });

  it("rejects a window that isn't within a single day", async () => {
    await expect(
      addRecurringWindow("staff-1", { dayOfWeek: 1, startMinutes: 0, endMinutes: 1441 }),
    ).rejects.toThrow(/within a single day/i);
  });
});

describe("addExceptionWindow", () => {
  it("stores an available exception with the given range", async () => {
    vi.mocked(prisma.availability.create).mockResolvedValue({} as never);
    const date = new Date("2026-07-04T00:00:00.000Z");
    await addExceptionWindow("staff-1", {
      date,
      isAvailable: true,
      startMinutes: 480,
      endMinutes: 720,
    });
    expect(prisma.availability.create).toHaveBeenCalledWith({
      data: {
        staffId: "staff-1",
        kind: "EXCEPTION",
        date,
        startMinutes: 480,
        endMinutes: 720,
        isAvailable: true,
      },
    });
  });

  it("an unavailable exception ignores any supplied times and stores a full-day placeholder", async () => {
    vi.mocked(prisma.availability.create).mockResolvedValue({} as never);
    const date = new Date("2026-07-04T00:00:00.000Z");
    await addExceptionWindow("staff-1", {
      date,
      isAvailable: false,
      startMinutes: 480,
      endMinutes: 720,
    });
    expect(prisma.availability.create).toHaveBeenCalledWith({
      data: {
        staffId: "staff-1",
        kind: "EXCEPTION",
        date,
        startMinutes: 0,
        endMinutes: 1440,
        isAvailable: false,
      },
    });
  });

  it("rejects an available exception missing a valid time range", async () => {
    const date = new Date("2026-07-04T00:00:00.000Z");
    await expect(addExceptionWindow("staff-1", { date, isAvailable: true })).rejects.toThrow();
    expect(prisma.availability.create).not.toHaveBeenCalled();
  });
});

describe("deleteAvailabilityRow", () => {
  it("scopes the delete to both the row id AND the owning staffId", async () => {
    vi.mocked(prisma.availability.deleteMany).mockResolvedValue({ count: 1 });
    await deleteAvailabilityRow("staff-1", "row-9");
    expect(prisma.availability.deleteMany).toHaveBeenCalledWith({
      where: { id: "row-9", staffId: "staff-1" },
    });
  });
});
