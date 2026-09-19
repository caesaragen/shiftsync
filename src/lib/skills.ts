import { Prisma, type Skill } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/authz";

/**
 * All skills in the org. Deliberately unscoped: unlike locations and staff
 * certifications, a `Skill` has no location or ownership relationship to
 * scope against — it's a flat, org-wide vocabulary ("bartender", "line
 * cook") shared by every role. Named `listAll*` (rather than `listSkills`)
 * and required to take a `SessionUser` — even though it isn't used to
 * filter — so that every call site visibly acknowledges the lack of
 * scoping was a deliberate choice, not an oversight, per the data-layer
 * scoping contract (see listStaffAssignments in staff-assignments.ts,
 * which DOES scope).
 */
export async function listAllSkills(_user: SessionUser): Promise<Skill[]> {
  return prisma.skill.findMany();
}

export async function createSkill(name: string): Promise<Skill> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Skill name is required.");
  }

  try {
    return await prisma.skill.create({ data: { name: trimmed } });
  } catch (error) {
    // Rethrow the `@unique` constraint violation as a readable message
    // instead of leaking the raw Prisma error to the UI.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error(`A skill named "${trimmed}" already exists.`);
    }
    throw error;
  }
}
