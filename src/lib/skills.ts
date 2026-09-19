import { Prisma, type Skill } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function listSkills(): Promise<Skill[]> {
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
