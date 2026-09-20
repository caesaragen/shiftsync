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
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="font-medium text-gray-900">
              {startTime} {startZone}
            </div>
            <div className="text-xs text-gray-500">
              to {endTimeDisplay}
              {endDayLabel}
            </div>
          </div>
          <div className="text-right">
            {isDraft && (
              <div className="inline-block rounded bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700">
                DRAFT
              </div>
            )}
            {isPremium && (
              <div className="mt-1 inline-block rounded bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-800">
                Premium
              </div>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs">
          <div className="text-gray-600">{shift.requiredSkill.name}</div>
          <div className={`font-medium ${isUnderstaffed ? "text-red-600" : "text-green-600"}`}>
            {assignedCount}/{shift.headcount} assigned
          </div>
        </div>
      </div>
    </Link>
  );
}
