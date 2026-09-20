import Link from "next/link";
import type { Shift, Location, Skill, ShiftAssignment, User } from "@prisma/client";
import { formatInstantClock, zoneAbbrev } from "@/lib/time/format";
import { isPremiumShift } from "@/lib/shifts";
import { toZoned } from "@/lib/time/zones";

export type ShiftWithDetail = Shift & {
  location: Location;
  requiredSkill: Skill;
  assignments: (ShiftAssignment & { staff: User })[];
};

export function ShiftCard({ shift }: { readonly shift: ShiftWithDetail }) {
  const startTime = formatInstantClock(shift.startAt, shift.location.timezone);
  const startZone = zoneAbbrev(shift.startAt, shift.location.timezone);
  const endZoned = toZoned(shift.endAt, shift.location.timezone);
  const startZoned = toZoned(shift.startAt, shift.location.timezone);

  // Determine if the shift is overnight (spans into the next day)
  const isOvernight = endZoned.day > startZoned.day;
  const endTimeDisplay = formatInstantClock(shift.endAt, shift.location.timezone);
  const endDayLabel = isOvernight ? " (next day)" : "";

  const assignedCount = shift.assignments.length;
  const isUnderstaffed = assignedCount < shift.headcount;
  const isPremium = isPremiumShift(shift.startAt, shift.location.timezone);

  const isDraft = shift.status === "DRAFT";

  return (
    <Link href={`/schedule/${shift.id}`}>
      <div
        className={`rounded border p-3 text-sm transition-colors hover:border-accent hover:bg-accent-subtle ${
          isDraft ? "border-border-subtle bg-surface" : "border-border-subtle bg-white"
        } ${isUnderstaffed ? "ring-1 ring-red-300" : ""}`}
      >
        <div className="font-medium text-gray-900">
          {startTime} {startZone}
        </div>
        <div className="text-xs text-gray-500">
          to {endTimeDisplay}
          {endDayLabel}
        </div>

        {/* Badges get their own wrapping row below the time -- a shared row
            with the time text caused it to wrap awkwardly at the week
            grid's narrow (7-column) card width. */}
        {(isDraft || isPremium) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {isDraft && (
              <span className="inline-block rounded bg-gray-200 px-1.5 py-0.5 text-[11px] font-medium text-gray-700">
                DRAFT
              </span>
            )}
            {isPremium && (
              <span className="inline-block rounded bg-yellow-100 px-1.5 py-0.5 text-[11px] font-medium text-yellow-800">
                Premium
              </span>
            )}
          </div>
        )}

        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-gray-600">{shift.requiredSkill.name}</span>
          <span
            className={`rounded-full px-2 py-0.5 font-medium ${
              isUnderstaffed ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"
            }`}
            aria-label={`${assignedCount} of ${shift.headcount} assigned`}
          >
            {assignedCount}/{shift.headcount}
          </span>
        </div>
      </div>
    </Link>
  );
}
