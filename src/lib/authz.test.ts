import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  requireUser,
  requireRole,
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

// `requireUser`/`requireRole` are the actual authorization boundary — every
// admin page and Server Action goes through them. Stub only the boundary
// they sit on: Auth.js's `auth()` (the session source) and Next's
// `redirect()` (which, in real Next.js, throws to halt rendering — mocked
// the same way here so a redirect genuinely short-circuits the function
// under test instead of falling through to code that assumes a session
// exists).
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const { prisma } = await import("@/lib/prisma");
const { auth } = await import("@/auth");
const { redirect } = await import("next/navigation");

const admin = { id: "u1", name: "A", email: "a@x.test", role: "ADMIN" as const };
const manager = { id: "u2", name: "M", email: "m@x.test", role: "MANAGER" as const };
const staff = { id: "u3", name: "S", email: "s@x.test", role: "STAFF" as const };

beforeEach(() => {
  vi.mocked(prisma.managerLocation.findMany).mockReset();
  vi.mocked(prisma.staffLocationCertification.findMany).mockReset();
  vi.mocked(auth).mockReset();
  vi.mocked(redirect).mockClear();
});

describe("requireUser", () => {
  it("redirects an unauthenticated session to /login", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("redirects a session with no user id to /login", async () => {
    // Defensive branch: a malformed/partial session (e.g. the id-copying
    // `session` callback in auth.ts never ran) must not be treated as
    // authenticated just because a session object exists.
    vi.mocked(auth).mockResolvedValue({ user: {} } as never);

    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("returns the SessionUser for an authenticated session", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", name: "Alex Admin", email: "admin@coastaleats.test", role: "ADMIN" },
    } as never);

    await expect(requireUser()).resolves.toEqual({
      id: "u1",
      name: "Alex Admin",
      email: "admin@coastaleats.test",
      role: "ADMIN",
    });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("requireRole", () => {
  it("redirects a MANAGER hitting an ADMIN-only route to /dashboard", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u2", name: "Morgan Manager", email: "m@x.test", role: "MANAGER" },
    } as never);

    await expect(requireRole("ADMIN")).rejects.toThrow("REDIRECT:/dashboard");
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("lets an ADMIN through an ADMIN-only route and returns the SessionUser", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", name: "Alex Admin", email: "admin@coastaleats.test", role: "ADMIN" },
    } as never);

    await expect(requireRole("ADMIN")).resolves.toEqual({
      id: "u1",
      name: "Alex Admin",
      email: "admin@coastaleats.test",
      role: "ADMIN",
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("still redirects an unauthenticated session to /login, not /dashboard", async () => {
    // requireRole delegates to requireUser first — an unauthenticated
    // visitor must hit the login redirect, not the role-mismatch one.
    vi.mocked(auth).mockResolvedValue(null);

    await expect(requireRole("ADMIN")).rejects.toThrow("REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
    expect(redirect).not.toHaveBeenCalledWith("/dashboard");
  });
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
