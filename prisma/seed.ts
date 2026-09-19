import { PrismaClient, type Location, type Role } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

// `Location` has no `@unique` column besides `id` (see schema.prisma), so it
// can't use `prisma.location.upsert` directly like `User` and `Skill` do.
// This helper gives it the same idempotent find-or-create-then-refresh
// semantics, keyed on name, so re-running the seed never creates duplicates.
async function upsertLocation(input: {
  name: string;
  timezone: string;
  address?: string;
}): Promise<Location> {
  const existing = await prisma.location.findFirst({ where: { name: input.name } });
  if (existing) {
    return prisma.location.update({
      where: { id: existing.id },
      data: { timezone: input.timezone, address: input.address },
    });
  }
  return prisma.location.create({
    data: { name: input.name, timezone: input.timezone, address: input.address },
  });
}

async function upsertUser(input: {
  name: string;
  email: string;
  password: string;
  role: Role;
  homeTimezone: string;
}) {
  const passwordHash = await hashPassword(input.password);
  return prisma.user.upsert({
    where: { email: input.email },
    update: { name: input.name, passwordHash, role: input.role, homeTimezone: input.homeTimezone },
    create: {
      name: input.name,
      email: input.email,
      passwordHash,
      role: input.role,
      homeTimezone: input.homeTimezone,
    },
  });
}

async function upsertManagerLocation(managerId: string, locationId: string) {
  await prisma.managerLocation.upsert({
    where: { managerId_locationId: { managerId, locationId } },
    create: { managerId, locationId },
    update: {},
  });
}

async function upsertStaffSkill(staffId: string, skillId: string) {
  await prisma.staffSkill.upsert({
    where: { staffId_skillId: { staffId, skillId } },
    create: { staffId, skillId },
    update: {},
  });
}

// Certification is modeled as periods (see staff-assignments.ts /
// certifyStaff): there is no `@@unique([staffId, locationId])` to upsert
// against any more, so idempotency is done by hand — only create a new
// period if there is no currently-active one already.
async function upsertCertification(staffId: string, locationId: string) {
  const active = await prisma.staffLocationCertification.findFirst({
    where: { staffId, locationId, endedAt: null },
  });
  if (active) return;
  await prisma.staffLocationCertification.create({
    data: { staffId, locationId, endedAt: null },
  });
}

async function main() {
  // --- Admin (Phase 0 — preserved exactly; Phase 0's Playwright tests and
  // the README depend on these precise values). ---
  await upsertUser({
    name: "Alex Admin",
    email: "admin@coastaleats.test",
    password: "admin123!",
    role: "ADMIN",
    homeTimezone: "America/New_York",
  });

  // --- Locations: 4 across 2 timezones. ---
  const harborPoint = await upsertLocation({
    name: "Harbor Point",
    timezone: "America/New_York",
    address: "12 Harbor Point Rd, Portland, ME",
  });
  const bayside = await upsertLocation({
    name: "Bayside",
    timezone: "America/New_York",
    address: "88 Bayside Ave, Boston, MA",
  });
  const pier39 = await upsertLocation({
    name: "Pier 39",
    timezone: "America/Los_Angeles",
    address: "39 Pier St, San Francisco, CA",
  });
  const sunsetGrill = await upsertLocation({
    name: "Sunset Grill",
    timezone: "America/Los_Angeles",
    address: "455 Sunset Blvd, Los Angeles, CA",
  });

  // --- Skills. ---
  const skillDefs = ["bartender", "line cook", "server", "host"] as const;
  const skills = Object.fromEntries(
    await Promise.all(
      skillDefs.map(async (name) => {
        const skill = await prisma.skill.upsert({
          where: { name },
          create: { name },
          update: {},
        });
        return [name, skill] as const;
      }),
    ),
  );

  // --- Managers: 2, one per timezone, each assigned to that timezone's 2
  // locations. ---
  const managerMorgan = await upsertUser({
    name: "Morgan Manager",
    email: "manager1@coastaleats.test",
    password: "manager1123!",
    role: "MANAGER",
    homeTimezone: "America/New_York",
  });
  await upsertManagerLocation(managerMorgan.id, harborPoint.id);
  await upsertManagerLocation(managerMorgan.id, bayside.id);

  const managerJamie = await upsertUser({
    name: "Jamie Manager",
    email: "manager2@coastaleats.test",
    password: "manager2123!",
    role: "MANAGER",
    homeTimezone: "America/Los_Angeles",
  });
  await upsertManagerLocation(managerJamie.id, pier39.id);
  await upsertManagerLocation(managerJamie.id, sunsetGrill.id);

  // --- Staff: 7, varied skills and certifications. `Jordan Tangle` is the
  // brief's "Timezone Tangle" scenario — certified at a location in EACH
  // timezone, which Phase 2's constraint engine needs to exist. ---
  const staffDefs = [
    {
      name: "Sam Server",
      email: "staff1@coastaleats.test",
      password: "staff1123!",
      homeTimezone: "America/New_York",
      skills: ["server", "host"],
      locations: [harborPoint],
    },
    {
      name: "Riley Bartender",
      email: "staff2@coastaleats.test",
      password: "staff2123!",
      homeTimezone: "America/New_York",
      skills: ["bartender", "server"],
      locations: [bayside],
    },
    {
      name: "Casey Cook",
      email: "staff3@coastaleats.test",
      password: "staff3123!",
      homeTimezone: "America/New_York",
      skills: ["line cook"],
      locations: [harborPoint, bayside],
    },
    {
      name: "Drew Host",
      email: "staff4@coastaleats.test",
      password: "staff4123!",
      homeTimezone: "America/Los_Angeles",
      skills: ["host", "server"],
      locations: [pier39],
    },
    {
      name: "Taylor Tender",
      email: "staff5@coastaleats.test",
      password: "staff5123!",
      homeTimezone: "America/Los_Angeles",
      skills: ["bartender"],
      locations: [sunsetGrill],
    },
    {
      name: "Morgan Cook",
      email: "staff6@coastaleats.test",
      password: "staff6123!",
      homeTimezone: "America/Los_Angeles",
      skills: ["line cook", "server"],
      locations: [pier39, sunsetGrill],
    },
    {
      name: "Jordan Tangle",
      email: "staff7@coastaleats.test",
      password: "staff7123!",
      homeTimezone: "America/New_York",
      skills: ["server", "bartender", "line cook", "host"],
      // Certified at a location in BOTH timezones — the "Timezone Tangle".
      locations: [harborPoint, pier39],
    },
  ] as const;

  for (const def of staffDefs) {
    const staff = await upsertUser({
      name: def.name,
      email: def.email,
      password: def.password,
      role: "STAFF",
      homeTimezone: def.homeTimezone,
    });
    for (const skillName of def.skills) {
      await upsertStaffSkill(staff.id, skills[skillName].id);
    }
    for (const location of def.locations) {
      await upsertCertification(staff.id, location.id);
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
