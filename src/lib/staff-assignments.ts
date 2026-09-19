import { prisma } from "@/lib/prisma";

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
 * Certify a staff member at a location, or re-certify one whose prior
 * certification was ended. Uses `upsert` against the
 * `@@unique([staffId, locationId])` constraint so re-certification clears
 * `endedAt` instead of failing on the unique constraint.
 */
export async function certifyStaff(staffId: string, locationId: string): Promise<void> {
  await prisma.staffLocationCertification.upsert({
    where: { staffId_locationId: { staffId, locationId } },
    create: { staffId, locationId, endedAt: null },
    update: { endedAt: null },
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
 * Staff users with their current skills and all location certifications
 * (active and ended). Ended certifications are included, not filtered out —
 * the admin page must show them distinctly rather than hiding them.
 */
export async function listStaffAssignments(): Promise<StaffAssignmentView[]> {
  const staff = await prisma.user.findMany({
    where: { role: "STAFF" },
    orderBy: { name: "asc" },
    include: {
      staffSkills: { include: { skill: true } },
      certifications: { include: { location: true } },
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
