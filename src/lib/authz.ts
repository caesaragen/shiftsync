import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export type SessionUser = { id: string; name: string; email: string; role: Role };

export class ForbiddenError extends Error {
  constructor(message = "You do not have access to this resource.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id, name, email, role } = session.user;
  return { id, name: name ?? "", email: email ?? "", role };
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/dashboard");
  return user;
}

// A tagged union, not a `string[] | "ALL"` sentinel: `"all".includes(x)` is
// call-compatible with `Array<string>.includes(x)` (both take a string and
// return a boolean), so a bare string sentinel does NOT make `.includes()`
// on the unnarrowed result a compile error — it silently does a substring
// check against the literal "ALL" instead. A discriminated union does not
// have this problem: `LocationScope` has no `.includes` member at all, so
// calling it without narrowing on `scope` first is a genuine `tsc` error.
// Callers should use `canSeeLocation` below rather than hand-rolling the
// narrowing check.
export type LocationScope = { scope: "all" } | { scope: "ids"; ids: string[] };

export async function visibleLocationScope(user: SessionUser): Promise<LocationScope> {
  if (user.role === "ADMIN") return { scope: "all" };
  if (user.role === "MANAGER") {
    const rows = await prisma.managerLocation.findMany({
      where: { managerId: user.id },
      select: { locationId: true },
    });
    return { scope: "ids", ids: rows.map((r) => r.locationId) };
  }
  // STAFF: only ACTIVE certifications count. A staff member de-certified
  // from a location (endedAt set) must lose visibility of it, so the filter
  // is applied at the query level rather than after the fact.
  const rows = await prisma.staffLocationCertification.findMany({
    where: { staffId: user.id, endedAt: null },
    select: { locationId: true },
  });
  return { scope: "ids", ids: rows.map((r) => r.locationId) };
}

export function canSeeLocation(scope: LocationScope, locationId: string): boolean {
  if (scope.scope === "all") return true;
  return scope.ids.includes(locationId);
}

export async function assertCanManageLocation(
  user: SessionUser,
  locationId: string,
): Promise<void> {
  // Reject STAFF outright, before any database lookup.
  if (user.role === "STAFF") throw new ForbiddenError();
  const scope = await visibleLocationScope(user);
  if (!canSeeLocation(scope, locationId)) throw new ForbiddenError();
}
