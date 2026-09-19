import { describe, it, expect, beforeEach, vi } from "vitest";

type GlobalWithPrisma = typeof globalThis & {
  prisma?: unknown;
};

describe("prisma client singleton", () => {
  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as GlobalWithPrisma).prisma;
  });

  it("caches the client on globalThis outside production", async () => {
    const { prisma } = await import("./prisma");

    expect((globalThis as GlobalWithPrisma).prisma).toBe(prisma);
  });

  it("reuses the cached instance on module re-evaluation instead of constructing a new client", async () => {
    const { prisma: first } = await import("./prisma");

    // Force the module to be re-evaluated from scratch, simulating what
    // Next.js dev-mode hot reload does on every file change.
    vi.resetModules();
    const { prisma: second } = await import("./prisma");

    expect(second).toBe(first);
    expect((globalThis as GlobalWithPrisma).prisma).toBe(second);
  });
});
