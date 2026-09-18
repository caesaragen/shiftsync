import { describe, it, expect } from "vitest";
import { prisma } from "./prisma";

describe("prisma client singleton", () => {
  it("exports a single shared PrismaClient instance across imports", async () => {
    const mod2 = await import("./prisma");
    expect(mod2.prisma).toBe(prisma);
  });
});
