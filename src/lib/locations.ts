import type { Location } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { visibleLocationScope, type SessionUser } from "@/lib/authz";

export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function listLocations(user: SessionUser): Promise<Location[]> {
  const scope = await visibleLocationScope(user);
  if (scope.scope === "all") return prisma.location.findMany({});
  return prisma.location.findMany({ where: { id: { in: scope.ids } } });
}

export async function createLocation(input: {
  name: string;
  timezone: string;
  address?: string;
}): Promise<Location> {
  if (!isValidTimezone(input.timezone)) {
    throw new Error(`Invalid timezone: "${input.timezone}"`);
  }
  return prisma.location.create({
    data: { name: input.name, timezone: input.timezone, address: input.address },
  });
}

export async function updateLocation(
  id: string,
  input: { name?: string; timezone?: string; address?: string },
): Promise<Location> {
  if (input.timezone !== undefined && !isValidTimezone(input.timezone)) {
    throw new Error(`Invalid timezone: "${input.timezone}"`);
  }
  return prisma.location.update({ where: { id }, data: input });
}
