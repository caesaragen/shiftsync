import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    skill: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { listSkills, createSkill } from "./skills";

beforeEach(() => {
  vi.mocked(prisma.skill.create).mockReset();
  vi.mocked(prisma.skill.findMany).mockReset();
});

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.19.3",
  });
}

describe("createSkill", () => {
  it("rejects an empty name without touching the database", async () => {
    await expect(createSkill("")).rejects.toThrow(/name/i);
    expect(prisma.skill.create).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only name without touching the database", async () => {
    await expect(createSkill("   ")).rejects.toThrow(/name/i);
    expect(prisma.skill.create).not.toHaveBeenCalled();
  });

  it("trims whitespace before creating", async () => {
    vi.mocked(prisma.skill.create).mockResolvedValue({
      id: "s1",
      name: "Bartending",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    await expect(createSkill("  Bartending  ")).resolves.toMatchObject({ name: "Bartending" });
    expect(prisma.skill.create).toHaveBeenCalledWith({ data: { name: "Bartending" } });
  });

  it("rethrows a readable error for a duplicate name instead of the raw Prisma error", async () => {
    vi.mocked(prisma.skill.create).mockRejectedValue(uniqueConstraintError());

    await expect(createSkill("Bartending")).rejects.toThrow(/already exists/i);
  });
});

describe("listSkills", () => {
  it("returns all skills", async () => {
    vi.mocked(prisma.skill.findMany).mockResolvedValue([{ id: "s1", name: "Bartending" }] as never);

    await expect(listSkills()).resolves.toEqual([{ id: "s1", name: "Bartending" }]);
  });
});
