import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hashPassword("admin123!");
  await prisma.user.upsert({
    where: { email: "admin@coastaleats.test" },
    update: {},
    create: {
      name: "Alex Admin",
      email: "admin@coastaleats.test",
      passwordHash,
      role: "ADMIN",
      homeTimezone: "America/New_York",
    },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
