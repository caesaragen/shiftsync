import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { visibleLocationScope, type SessionUser } from "@/lib/authz";

export type StaffAssignmentView = {
  id: string;
  name: string;
  email: string;
  skills: { id: string; name: string }[];
  certifications: {
    id: string;
    locationId: string;
    locationName: string;
    certifiedAt: Date;
    endedAt: Date | null;
  }[];
};

/**
 * Assign a skill to a staff member. Idempotent: assigning a skill the staff
 * member already holds is a no-op rather than a unique-constraint error.
 */
export async function assignSkill(staffId: string, skillId: string): Promise<void> {
  await prisma.staffSkill.upsert({
    where: { staffId_skillId: { staffId, skillId } },
    create: { staffId, skillId },
    update: {},
  });
}

/**
 * Remove a skill from a staff member. Uses `deleteMany` (rather than
 * `delete` against the unique key) so removing a skill that is already
 * absent is a no-op instead of a "record not found" error. Skills have no
 * audit requirement (unlike location certifications — see decertifyStaff),
 * so this is a hard delete by design.
 */
export async function removeSkill(staffId: string, skillId: string): Promise<void> {
  await prisma.staffSkill.deleteMany({ where: { staffId, skillId } });
}

/**
 * Certify a staff member at a location. Certification is modeled as
 * *periods* (design spec §5 decision 1), not a single row per (staff,
 * location): if there is no currently-active certification (a row with
 * `endedAt: null`), this creates a NEW row rather than reviving the old
 * one. A staff member certified Jan 1, de-certified Jun 1, and re-certified
 * Sep 1 must end up with two distinct rows — the Jan–Jun period and a new
 * Sep–present period — not one row that overwrites the Jun de-certification
 * and asserts continuous certification across the gap. A no-op when a
 * currently-active certification already exists.
 */
export async function certifyStaff(staffId: string, locationId: string): Promise<void> {
  const active = await prisma.staffLocationCertification.findFirst({
    where: { staffId, locationId, endedAt: null },
  });
  if (active) return;
  await prisma.staffLocationCertification.create({
    data: { staffId, locationId, endedAt: null },
  });
}

/**
 * De-certify a staff member from a location. This is a soft state change
 * (design spec §5 decision 1): it sets `endedAt`, and MUST NEVER delete the
 * row, so historical shift data stays intact and auditable for Phase 2's
 * constraint engine and Phase 5's audit trail.
 */
export async function decertifyStaff(staffId: string, locationId: string): Promise<void> {
  await prisma.staffLocationCertification.updateMany({
    where: { staffId, locationId, endedAt: null },
    data: { endedAt: new Date() },
  });
}

/**
 * Staff users with their current skills and location certifications.
 * Ended certifications are included, not filtered out — callers must show
 * them distinctly rather than hiding them.
 *
 * Scoped by the caller (uniform data-layer scoping contract) in TWO
 * dimensions, both of which matter — scoping only the first is a leak:
 *  1. WHICH staff are returned at all: an ADMIN sees every staff member; a
 *     MANAGER sees only staff with a certification — active or ended — at
 *     a location they manage; a STAFF user sees only their own record.
 *     STAFF is intentionally scoped to "self", not to "everyone certified
 *     at my locations" — the latter would use `visibleLocationScope`'s
 *     STAFF branch (my active locations) to leak every OTHER staff member
 *     certified there, which is not what a plain staff member should see
 *     about their coworkers.
 *  2. WHICH of a returned staff member's certifications are included: a
 *     MANAGER matching on (1) must not then receive that staff member's
 *     FULL certification history — only the certifications at locations
 *     the manager actually manages. Without this, a Harbor Point manager
 *     who can see a staff member (because they're certified there) would
 *     also learn that person is certified at Pier 39, a location the
 *     manager has no relationship to. ADMIN and STAFF (self) keep the
 *     full history — an admin seeing the whole org, and a staff member
 *     seeing their own complete record, are both correct.
 */
export async function listStaffAssignments(user: SessionUser): Promise<StaffAssignmentView[]> {
  const where: Prisma.UserWhereInput = { role: "STAFF" };
  let certificationsWhere: Prisma.StaffLocationCertificationWhereInput | undefined;

  if (user.role === "STAFF") {
    where.id = user.id;
  } else if (user.role === "MANAGER") {
    const scope = await visibleLocationScope(user);
    if (scope.scope === "ids") {
      where.certifications = { some: { locationId: { in: scope.ids } } };
      certificationsWhere = { locationId: { in: scope.ids } };
    }
  }
  // ADMIN: no extra filter on either dimension — sees every staff member's
  // full certification history.

  const staff = await prisma.user.findMany({
    where,
    orderBy: { name: "asc" },
    include: {
      staffSkills: { include: { skill: true } },
      certifications: { where: certificationsWhere, include: { location: true } },
    },
  });

  return staff.map((member) => ({
    id: member.id,
    name: member.name,
    email: member.email,
    skills: member.staffSkills.map((ss) => ({ id: ss.skill.id, name: ss.skill.name })),
    certifications: member.certifications.map((cert) => ({
      id: cert.id,
      locationId: cert.locationId,
      locationName: cert.location.name,
      certifiedAt: cert.certifiedAt,
      endedAt: cert.endedAt,
    })),
  }));
}
