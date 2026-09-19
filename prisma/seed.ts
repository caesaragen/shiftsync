import { PrismaClient, type Location, type Role, type Shift } from "@prisma/client";
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

// Seeds a specific, already-ended certification period so the soft-delete
// UI (the muted "ended {date}" row on the admin staff page) has demo data
// without an evaluator having to perform a de-certification themselves.
// Idempotent: only creates the ended row if no certification at all exists
// yet for this (staff, location) pair, so re-running the seed never piles
// up duplicate ended periods.
async function upsertEndedCertification(
  staffId: string,
  locationId: string,
  certifiedAt: Date,
  endedAt: Date,
) {
  const existing = await prisma.staffLocationCertification.findFirst({
    where: { staffId, locationId },
  });
  if (existing) return;
  await prisma.staffLocationCertification.create({
    data: { staffId, locationId, certifiedAt, endedAt },
  });
}

// Availability has no natural unique key besides `id`, so idempotency is
// hand-rolled the same way `upsertLocation` does it: match on every
// identifying field (staff, kind, day-or-date, and the window itself) and
// only create when no such row exists yet. Re-running the seed with the
// same fixture data therefore never piles up duplicate windows.
async function upsertAvailability(input: {
  staffId: string;
  kind: "RECURRING" | "EXCEPTION";
  dayOfWeek?: number;
  date?: Date;
  startMinutes: number;
  endMinutes: number;
  isAvailable?: boolean;
}) {
  const isAvailable = input.isAvailable ?? true;
  const existing = await prisma.availability.findFirst({
    where: {
      staffId: input.staffId,
      kind: input.kind,
      dayOfWeek: input.dayOfWeek ?? null,
      date: input.date ?? null,
      startMinutes: input.startMinutes,
      endMinutes: input.endMinutes,
    },
  });
  if (existing) {
    if (existing.isAvailable !== isAvailable) {
      await prisma.availability.update({ where: { id: existing.id }, data: { isAvailable } });
    }
    return;
  }
  await prisma.availability.create({
    data: {
      staffId: input.staffId,
      kind: input.kind,
      dayOfWeek: input.dayOfWeek ?? null,
      date: input.date ?? null,
      startMinutes: input.startMinutes,
      endMinutes: input.endMinutes,
      isAvailable,
    },
  });
}

// Shift also has no natural unique key. A (location, startAt, endAt) triple
// is unique enough for this fixed demo week, so re-running the seed updates
// the same row (status/skill/notes) in place instead of creating a sibling.
async function upsertShift(input: {
  locationId: string;
  startAt: Date;
  endAt: Date;
  requiredSkillId: string;
  status: "DRAFT" | "PUBLISHED";
  createdById: string;
  notes?: string;
}): Promise<Shift> {
  const existing = await prisma.shift.findFirst({
    where: { locationId: input.locationId, startAt: input.startAt, endAt: input.endAt },
  });
  if (existing) {
    return prisma.shift.update({
      where: { id: existing.id },
      data: {
        requiredSkillId: input.requiredSkillId,
        status: input.status,
        notes: input.notes ?? null,
        createdById: input.createdById,
      },
    });
  }
  return prisma.shift.create({
    data: {
      locationId: input.locationId,
      startAt: input.startAt,
      endAt: input.endAt,
      requiredSkillId: input.requiredSkillId,
      status: input.status,
      notes: input.notes ?? null,
      createdById: input.createdById,
    },
  });
}

// `ShiftAssignment` DOES have `@@unique([shiftId, staffId])`, so this is a
// plain upsert -- re-running the seed is naturally idempotent here.
async function upsertAssignment(shiftId: string, staffId: string, assignedById: string) {
  await prisma.shiftAssignment.upsert({
    where: { shiftId_staffId: { shiftId, staffId } },
    create: { shiftId, staffId, assignedById },
    update: {},
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

  const staffByEmail: Record<string, { id: string }> = {};
  for (const def of staffDefs) {
    const staff = await upsertUser({
      name: def.name,
      email: def.email,
      password: def.password,
      role: "STAFF",
      homeTimezone: def.homeTimezone,
    });
    staffByEmail[def.email] = staff;
    for (const skillName of def.skills) {
      await upsertStaffSkill(staff.id, skills[skillName].id);
    }
    for (const location of def.locations) {
      await upsertCertification(staff.id, location.id);
    }
  }

  // --- An ended certification, so the soft-delete UI (the muted "ended
  // {date}" row on the admin staff page) has demo data without the
  // evaluator having to de-certify someone themselves. Riley Bartender
  // (seeded above as certified at Bayside only) previously worked — and was
  // de-certified from — Harbor Point, a location she is no longer active
  // at. ---
  await upsertEndedCertification(
    staffByEmail["staff2@coastaleats.test"].id,
    harborPoint.id,
    new Date("2026-01-05T00:00:00Z"),
    new Date("2026-04-12T00:00:00Z"),
  );

  // --- Phase 2: recurring availability, one EXCEPTION, and a demo week of
  // shifts/assignments for the constraint engine to have something real to
  // bite on. Deliberately varied per person (not everyone 9-5) -- see
  // README.md's "Ambiguity decisions" for the timezone/premium/overnight
  // rules these fixtures exercise, and task-9-report.md for exactly which
  // fixture below enables which of the assessment brief's six scenarios. ---
  const sam = staffByEmail["staff1@coastaleats.test"];
  const riley = staffByEmail["staff2@coastaleats.test"];
  const casey = staffByEmail["staff3@coastaleats.test"];
  const drew = staffByEmail["staff4@coastaleats.test"];
  const taylor = staffByEmail["staff5@coastaleats.test"];
  const morgan = staffByEmail["staff6@coastaleats.test"];
  const jordan = staffByEmail["staff7@coastaleats.test"];

  // Sam Server (ET): early weekday shift, no weekends.
  for (const dayOfWeek of [1, 2, 3, 4, 5]) {
    await upsertAvailability({
      staffId: sam.id,
      kind: "RECURRING",
      dayOfWeek,
      startMinutes: 8 * 60, // 08:00
      endMinutes: 16 * 60, // 16:00
    });
  }
  // EXCEPTION: Sam is out the whole day Wed Sep 23 2026 (a one-off, overrides
  // her Wednesday RECURRING row entirely for that date) -- the required
  // "at least one EXCEPTION row."
  await upsertAvailability({
    staffId: sam.id,
    kind: "EXCEPTION",
    date: new Date("2026-09-23T00:00:00Z"),
    startMinutes: 0,
    endMinutes: 24 * 60,
    isAvailable: false,
  });

  // Riley Bartender (ET): evenings only, Wed-Sat. Friday's row deliberately
  // spans past midnight (16:00 Fri -> 03:00 Sat, `endMinutes: 1620`) per
  // design decision (d) -- the same "single row crossing midnight" shape as
  // an overnight shift itself -- so she can actually close the Friday-night
  // bar and still be covered for the Bayside overnight shift below.
  await upsertAvailability({
    staffId: riley.id,
    kind: "RECURRING",
    dayOfWeek: 3,
    startMinutes: 16 * 60,
    endMinutes: 24 * 60,
  });
  await upsertAvailability({
    staffId: riley.id,
    kind: "RECURRING",
    dayOfWeek: 4,
    startMinutes: 16 * 60,
    endMinutes: 24 * 60,
  });
  await upsertAvailability({
    staffId: riley.id,
    kind: "RECURRING",
    dayOfWeek: 5,
    startMinutes: 16 * 60,
    endMinutes: 27 * 60,
  });
  await upsertAvailability({
    staffId: riley.id,
    kind: "RECURRING",
    dayOfWeek: 6,
    startMinutes: 16 * 60,
    endMinutes: 24 * 60,
  });

  // Casey Cook (ET): long, wide-open Mon-Sat window -- deliberately generous
  // so her seeded Mon-Fri assignments below (a clean 5-day streak, 40h/week)
  // are unambiguously WITHIN her availability, not merely close to it.
  for (const dayOfWeek of [1, 2, 3, 4, 5, 6]) {
    await upsertAvailability({
      staffId: casey.id,
      kind: "RECURRING",
      dayOfWeek,
      startMinutes: 10 * 60, // 10:00
      endMinutes: 22 * 60, // 22:00
    });
  }

  // Drew Host (PT): daytime Tue-Thu, longer Fri/Sat evenings (covers the
  // Friday premium shift below).
  for (const dayOfWeek of [2, 3, 4]) {
    await upsertAvailability({
      staffId: drew.id,
      kind: "RECURRING",
      dayOfWeek,
      startMinutes: 11 * 60,
      endMinutes: 19 * 60,
    });
  }
  for (const dayOfWeek of [5, 6]) {
    await upsertAvailability({
      staffId: drew.id,
      kind: "RECURRING",
      dayOfWeek,
      startMinutes: 11 * 60,
      endMinutes: 23 * 60,
    });
  }

  // Taylor Tender (PT): evening bartender Thu-Sat, plus a Sunday midday window.
  for (const dayOfWeek of [4, 5, 6]) {
    await upsertAvailability({
      staffId: taylor.id,
      kind: "RECURRING",
      dayOfWeek,
      startMinutes: 17 * 60,
      endMinutes: 24 * 60,
    });
  }
  await upsertAvailability({
    staffId: taylor.id,
    kind: "RECURRING",
    dayOfWeek: 7,
    startMinutes: 12 * 60,
    endMinutes: 20 * 60,
  });

  // Morgan Cook (PT): daytime Sun-Thu, weekends off (the mirror image of
  // Riley/Drew/Taylor's weekend-heavy schedules -- part of the "deliberately
  // varied" spread).
  for (const dayOfWeek of [7, 1, 2, 3, 4]) {
    await upsertAvailability({
      staffId: morgan.id,
      kind: "RECURRING",
      dayOfWeek,
      startMinutes: 9 * 60,
      endMinutes: 17 * 60,
    });
  }

  // Jordan Tangle (ET): standard Mon-Fri business hours -- this is the
  // literal "Timezone Tangle" fixture from the brief (09:00-17:00 Eastern).
  for (const dayOfWeek of [1, 2, 3, 4, 5]) {
    await upsertAvailability({
      staffId: jordan.id,
      kind: "RECURRING",
      dayOfWeek,
      startMinutes: 9 * 60,
      endMinutes: 17 * 60,
    });
  }

  // --- A week of shifts (Mon Sep 21 - Sun Sep 27, 2026) across all 4
  // locations, DRAFT and PUBLISHED, covering a normal day shift, an
  // overnight shift, a Friday-evening premium shift, and a Saturday-evening
  // premium shift. See task-9-report.md for the fixture-to-scenario map. ---

  // Harbor Point (ET) -----------------------------------------------------
  const hpNormalDay = await upsertShift({
    locationId: harborPoint.id,
    startAt: new Date("2026-09-21T12:00:00Z"), // Mon 08:00 EDT
    endAt: new Date("2026-09-21T20:00:00Z"), // Mon 16:00 EDT
    requiredSkillId: skills.server.id,
    status: "PUBLISHED",
    createdById: managerMorgan.id,
    notes: "Normal day shift.",
  });
  await upsertAssignment(hpNormalDay.id, sam.id, managerMorgan.id);

  const hpMon = await upsertShift({
    locationId: harborPoint.id,
    startAt: new Date("2026-09-21T14:00:00Z"), // Mon 10:00 EDT
    endAt: new Date("2026-09-21T22:00:00Z"), // Mon 18:00 EDT
    requiredSkillId: skills["line cook"].id,
    status: "PUBLISHED",
    createdById: managerMorgan.id,
  });
  await upsertAssignment(hpMon.id, casey.id, managerMorgan.id); // streak day 1/5

  const hpWed = await upsertShift({
    locationId: harborPoint.id,
    startAt: new Date("2026-09-23T14:00:00Z"), // Wed 10:00 EDT
    endAt: new Date("2026-09-23T22:00:00Z"), // Wed 18:00 EDT
    requiredSkillId: skills["line cook"].id,
    status: "PUBLISHED",
    createdById: managerMorgan.id,
  });
  await upsertAssignment(hpWed.id, casey.id, managerMorgan.id); // streak day 3/5

  const hpFri = await upsertShift({
    locationId: harborPoint.id,
    startAt: new Date("2026-09-25T14:00:00Z"), // Fri 10:00 EDT
    endAt: new Date("2026-09-25T22:00:00Z"), // Fri 18:00 EDT
    requiredSkillId: skills["line cook"].id,
    status: "PUBLISHED",
    createdById: managerMorgan.id,
  });
  await upsertAssignment(hpFri.id, casey.id, managerMorgan.id); // streak day 5/5, 40h/week

  await upsertShift({
    locationId: harborPoint.id,
    startAt: new Date("2026-09-26T14:00:00Z"), // Sat 10:00 EDT
    endAt: new Date("2026-09-26T22:00:00Z"), // Sat 18:00 EDT
    requiredSkillId: skills.host.id,
    status: "DRAFT",
    createdById: managerMorgan.id,
    notes: "Still finalizing headcount.",
  });

  // Bayside (ET) ------------------------------------------------------------
  const baysideTue = await upsertShift({
    locationId: bayside.id,
    startAt: new Date("2026-09-22T14:00:00Z"), // Tue 10:00 EDT
    endAt: new Date("2026-09-22T22:00:00Z"), // Tue 18:00 EDT
    requiredSkillId: skills["line cook"].id,
    status: "PUBLISHED",
    createdById: managerMorgan.id,
  });
  await upsertAssignment(baysideTue.id, casey.id, managerMorgan.id); // streak day 2/5

  const baysideThu = await upsertShift({
    locationId: bayside.id,
    startAt: new Date("2026-09-24T14:00:00Z"), // Thu 10:00 EDT
    endAt: new Date("2026-09-24T22:00:00Z"), // Thu 18:00 EDT
    requiredSkillId: skills["line cook"].id,
    status: "PUBLISHED",
    createdById: managerMorgan.id,
  });
  await upsertAssignment(baysideThu.id, casey.id, managerMorgan.id); // streak day 4/5

  const baysideOvernight = await upsertShift({
    locationId: bayside.id,
    startAt: new Date("2026-09-26T03:00:00Z"), // Fri 23:00 EDT -> Sat 03:00 EDT, single row spanning midnight
    endAt: new Date("2026-09-26T07:00:00Z"),
    requiredSkillId: skills.bartender.id,
    status: "PUBLISHED",
    createdById: managerMorgan.id,
    notes: "Overnight closing shift.",
  });
  await upsertAssignment(baysideOvernight.id, riley.id, managerMorgan.id);

  await upsertShift({
    locationId: bayside.id,
    startAt: new Date("2026-09-27T16:00:00Z"), // Sun 12:00 EDT
    endAt: new Date("2026-09-28T00:00:00Z"), // Sun 20:00 EDT
    requiredSkillId: skills.server.id,
    status: "DRAFT",
    createdById: managerMorgan.id,
  });

  // Pier 39 (PT) --------------------------------------------------------------
  const pier39FridayPremium = await upsertShift({
    locationId: pier39.id,
    startAt: new Date("2026-09-26T00:00:00Z"), // Fri 17:00 PDT
    endAt: new Date("2026-09-26T06:00:00Z"), // Fri 23:00 PDT
    requiredSkillId: skills.server.id,
    status: "PUBLISHED",
    createdById: managerJamie.id,
    notes: "Friday-evening premium shift.",
  });
  await upsertAssignment(pier39FridayPremium.id, drew.id, managerJamie.id);

  await upsertShift({
    locationId: pier39.id,
    startAt: new Date("2026-09-21T16:00:00Z"), // Mon 09:00 PDT
    endAt: new Date("2026-09-22T00:00:00Z"), // Mon 17:00 PDT
    requiredSkillId: skills.server.id,
    status: "DRAFT",
    createdById: managerJamie.id,
  });

  const pier39Wed = await upsertShift({
    locationId: pier39.id,
    startAt: new Date("2026-09-23T16:00:00Z"), // Wed 09:00 PDT
    endAt: new Date("2026-09-24T00:00:00Z"), // Wed 17:00 PDT
    requiredSkillId: skills["line cook"].id,
    status: "PUBLISHED",
    createdById: managerJamie.id,
  });
  await upsertAssignment(pier39Wed.id, morgan.id, managerJamie.id);

  // Sunset Grill (PT) -----------------------------------------------------
  const sunsetSaturdayPremium = await upsertShift({
    locationId: sunsetGrill.id,
    startAt: new Date("2026-09-27T01:00:00Z"), // Sat 18:00 PDT
    endAt: new Date("2026-09-27T06:00:00Z"), // Sat 23:00 PDT
    requiredSkillId: skills.bartender.id,
    status: "PUBLISHED",
    createdById: managerJamie.id,
    notes: "Saturday-evening premium shift.",
  });
  await upsertAssignment(sunsetSaturdayPremium.id, taylor.id, managerJamie.id);

  const sunsetTue = await upsertShift({
    locationId: sunsetGrill.id,
    startAt: new Date("2026-09-22T16:00:00Z"), // Tue 09:00 PDT
    endAt: new Date("2026-09-23T00:00:00Z"), // Tue 17:00 PDT
    requiredSkillId: skills.server.id,
    status: "PUBLISHED",
    createdById: managerJamie.id,
  });
  await upsertAssignment(sunsetTue.id, morgan.id, managerJamie.id);

  await upsertShift({
    locationId: sunsetGrill.id,
    startAt: new Date("2026-09-25T00:00:00Z"), // Thu 17:00 PDT
    endAt: new Date("2026-09-25T07:00:00Z"), // Fri 00:00 PDT
    requiredSkillId: skills.bartender.id,
    status: "DRAFT",
    createdById: managerJamie.id,
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
