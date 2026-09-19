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

// `"ALL"` is a sentinel meaning "every location" for admins — it avoids
// loading every location id just to check membership. Callers must check
// `=== "ALL"` before treating the result as an array (see
// `assertCanManageLocation` below for the pattern); the union return type
// makes it a type error to call array methods on the result without that
// narrowing check first.
export async function visibleLocationIds(user: SessionUser): Promise<string[] | "ALL"> {
  if (user.role === "ADMIN") return "ALL";
  if (user.role === "MANAGER") {
    const rows = await prisma.managerLocation.findMany({
      where: { managerId: user.id },
      select: { locationId: true },
    });
    return rows.map((r) => r.locationId);
  }
  // STAFF: only ACTIVE certifications count. A staff member de-certified
  // from a location (endedAt set) must lose visibility of it, so the filter
  // is applied at the query level rather than after the fact.
  const rows = await prisma.staffLocationCertification.findMany({
    where: { staffId: user.id, endedAt: null },
    select: { locationId: true },
  });
  return rows.map((r) => r.locationId);
}

export async function assertCanManageLocation(
  user: SessionUser,
  locationId: string,
): Promise<void> {
  // Reject STAFF outright, before any database lookup.
  if (user.role === "STAFF") throw new ForbiddenError();
  const visible = await visibleLocationIds(user);
  if (visible === "ALL") return;
  if (!visible.includes(locationId)) throw new ForbiddenError();
}
