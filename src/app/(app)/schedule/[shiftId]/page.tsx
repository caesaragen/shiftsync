import Link from "next/link";
import { requireUser } from "@/lib/authz";
import { getShift, type ShiftWithDetail } from "@/lib/shifts";
import { prisma } from "@/lib/prisma";
import { loadContext, validateAssignment } from "@/lib/constraints/engine";
import { describeAvailabilityForDate } from "@/lib/availability";
import { formatInstantClock, zoneAbbrev } from "@/lib/time/format";
import { toZoned, weekBounds, localDateKey } from "@/lib/time/zones";
import { BackIcon } from "@/components/icons";
import {
  AssignmentPanel,
  type CandidateVerdict,
  type RosterEntry,
} from "./_components/AssignmentPanel";

/**
 * Enumerates every candidate "eligible to be considered" for `shift`:
 * staff members with an ACTIVE certification at the shift's location. This
 * is the SAME query pattern `suggestAlternatives` uses to find candidates
 * (`staffLocationCertification.findMany` scoped to `locationId` and
 * `endedAt: null`) -- deliberately reused rather than a second, possibly
 * divergent, way of answering "who could work here."
 *
 * Every candidate's verdict comes directly from `loadContext` +
 * `validateAssignment` -- this function does not filter candidates by
 * skill, availability, or anything else the engine already decides. A
 * candidate who lacks the required skill still appears here, with a BLOCK
 * verdict carrying the engine's own message, so a manager sees the whole
 * roster of who could conceivably be certified here and exactly why each
 * one can or can't take this specific shift.
 */
async function loadCandidateVerdicts(shift: ShiftWithDetail): Promise<CandidateVerdict[]> {
  const certifications = await prisma.staffLocationCertification.findMany({
    where: { locationId: shift.locationId, endedAt: null },
    include: { staff: true },
  });

  const alreadyAssigned = new Set(shift.assignments.map((a) => a.staffId));

  const candidates: CandidateVerdict[] = [];
  for (const cert of certifications) {
    if (alreadyAssigned.has(cert.staffId)) continue;

    const ctx = await loadContext(cert.staffId, shift.id);
    const result = validateAssignment(ctx);

    candidates.push({
      staffId: cert.staffId,
      name: cert.staff.name,
      allowed: result.allowed,
      requiresOverride: result.requiresOverride,
      violations: result.violations,
      // Their actual hours on the shift's date, shown up front rather than
      // only surfacing (as part of a longer sentence) once a manager
      // selects a candidate who happens to be blocked on UNAVAILABLE.
      availabilityText: describeAvailabilityForDate(
        ctx.availability,
        shift.startAt,
        ctx.staff.homeTimezone,
      ),
    });
  }

  return candidates;
}

export default async function ShiftDetailPage({
  params,
}: {
  readonly params: Promise<{ shiftId: string }>;
}) {
  const { shiftId } = await params;
  const user = await requireUser();

  let shift: ShiftWithDetail;
  try {
    shift = await getShift(user, shiftId);
  } catch (error) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-12">
        <Link
          href="/schedule"
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-gray-900"
        >
          <BackIcon className="h-4 w-4" />
          Back to Schedule
        </Link>
        <p role="alert" className="mt-4 text-sm text-red-600">
          {error instanceof Error ? error.message : "This shift could not be loaded."}
        </p>
      </main>
    );
  }

  const timezone = shift.location.timezone;
  const startClock = formatInstantClock(shift.startAt, timezone);
  const endClock = formatInstantClock(shift.endAt, timezone);
  const zone = zoneAbbrev(shift.startAt, timezone);
  const startZoned = toZoned(shift.startAt, timezone);
  const endZoned = toZoned(shift.endAt, timezone);
  const isOvernight = endZoned.startOf("day") > startZoned.startOf("day");
  const dateLabel = startZoned.toFormat("cccc, LLLL d, yyyy");

  const roster: RosterEntry[] = shift.assignments.map((a) => ({
    assignmentId: a.id,
    staffId: a.staffId,
    name: a.staff.name,
  }));

  const canManage = user.role === "MANAGER" || user.role === "ADMIN";
  const candidates = canManage ? await loadCandidateVerdicts(shift) : [];

  // Return to the week this shift actually belongs to, not just the
  // schedule page's own defaults -- otherwise "back" would silently drop
  // the manager into a different location/week than the one they came from.
  const { start: weekStart } = weekBounds(shift.startAt, timezone);
  const weekOfStr = localDateKey(weekStart, timezone);
  const backHref = `/schedule?locationId=${shift.locationId}&weekOf=${weekOfStr}`;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-gray-900"
      >
        <BackIcon className="h-4 w-4" />
        Back to Schedule
      </Link>
      <p className="mt-4 text-sm text-gray-500">{shift.location.name}</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">
        {startClock}–{endClock} {zone}
        {isOvernight && " (next day)"}
      </h1>
      <p className="mt-1 text-sm text-gray-500">{dateLabel}</p>

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-gray-500">Skill required</dt>
          <dd className="mt-1 font-medium">{shift.requiredSkill.name}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Headcount</dt>
          <dd className="mt-1 font-medium">
            {roster.length}/{shift.headcount}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Status</dt>
          <dd className="mt-1 font-medium">{shift.status}</dd>
        </div>
        {shift.notes && (
          <div>
            <dt className="text-gray-500">Notes</dt>
            <dd className="mt-1 font-medium">{shift.notes}</dd>
          </div>
        )}
      </dl>

      {canManage ? (
        <AssignmentPanel shiftId={shift.id} roster={roster} candidates={candidates} />
      ) : (
        <section className="mt-10">
          <h2 className="text-base font-semibold tracking-tight">Roster</h2>
          {roster.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No one is assigned to this shift yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {roster.map((entry) => (
                <li key={entry.assignmentId}>{entry.name}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
