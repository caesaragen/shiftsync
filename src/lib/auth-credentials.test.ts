import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@prisma/client";
import { hashPassword } from "@/lib/password";
import * as passwordModule from "@/lib/password";

// Stub ONLY the Prisma user lookup. `verifyPassword` (from `@/lib/password`)
// is left un-mocked so the password comparison exercised below is the real
// bcrypt comparison, not a fake.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { verifyCredentials } from "@/lib/auth-credentials";

const findUniqueMock = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;

const CORRECT_PASSWORD = "correct-horse-battery-staple";

async function stubExistingUser() {
  const passwordHash = await hashPassword(CORRECT_PASSWORD);
  findUniqueMock.mockResolvedValueOnce({
    id: "user-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    passwordHash,
    role: "STAFF" as Role,
    homeTimezone: "America/New_York",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe("verifyCredentials", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
  });

  it("returns null for missing/empty credentials", async () => {
    await expect(verifyCredentials(undefined, undefined)).resolves.toBeNull();
    await expect(verifyCredentials("", "")).resolves.toBeNull();
    await expect(verifyCredentials("ada@example.com", "")).resolves.toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("returns null (does not throw) for non-string credentials", async () => {
    // A crafted POST body can put any JSON value here — objects, arrays,
    // numbers. This must fail closed, not blow up with a Prisma
    // validation error when the bad value reaches the `where` clause.
    await expect(verifyCredentials({ injected: true }, "some-password")).resolves.toBeNull();
    await expect(verifyCredentials("ada@example.com", ["not", "a", "string"])).resolves.toBeNull();
    await expect(verifyCredentials(12345, "some-password")).resolves.toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("returns null for an unknown email", async () => {
    findUniqueMock.mockResolvedValueOnce(null);

    await expect(verifyCredentials("nobody@example.com", "whatever")).resolves.toBeNull();
    expect(findUniqueMock).toHaveBeenCalledWith({ where: { email: "nobody@example.com" } });
  });

  it("still performs a bcrypt comparison for an unknown email (timing mitigation)", async () => {
    // Regression guard for the user-enumeration timing side-channel: the
    // "no such user" path must pay comparable bcrypt cost to the "wrong
    // password" path, so we assert `verifyPassword` is actually invoked
    // even when Prisma finds no matching row.
    findUniqueMock.mockResolvedValueOnce(null);
    const verifyPasswordSpy = vi.spyOn(passwordModule, "verifyPassword");

    await expect(verifyCredentials("nobody@example.com", "whatever")).resolves.toBeNull();

    expect(verifyPasswordSpy).toHaveBeenCalledTimes(1);
    expect(verifyPasswordSpy).toHaveBeenCalledWith(
      "whatever",
      expect.stringMatching(/^\$2[aby]\$/),
    );

    verifyPasswordSpy.mockRestore();
  });

  it("returns null for the wrong password on an existing user", async () => {
    await stubExistingUser();

    await expect(verifyCredentials("ada@example.com", "wrong-password")).resolves.toBeNull();
  });

  it("returns the user for correct credentials", async () => {
    await stubExistingUser();

    await expect(verifyCredentials("ada@example.com", CORRECT_PASSWORD)).resolves.toEqual({
      id: "user-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      role: "STAFF",
    });
  });
});
