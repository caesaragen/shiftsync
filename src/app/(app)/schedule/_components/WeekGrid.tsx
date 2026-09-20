import type { Shift, Location, Skill, ShiftAssignment, User } from "@prisma/client";
import { ShiftCard } from "./ShiftCard";
import { toZoned, localDateKey } from "@/lib/time/zones";

export type ShiftWithDetail = Shift & {
  location: Location;
  requiredSkill: Skill;
  assignments: (ShiftAssignment & { staff: User })[];
};

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_ABBREV: Record<string, string> = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};

export function WeekGrid({
  shifts,
  location,
  weekStart,
}: {
  readonly shifts: ShiftWithDetail[];
  readonly location: Location;
  readonly weekStart: Date;
}) {
  // Build a map of shifts by the local calendar day they start on
  const shiftsByDay: Record<number, ShiftWithDetail[]> = {};
  for (let i = 0; i < 7; i++) {
    shiftsByDay[i] = [];
  }

  shifts.forEach((shift) => {
    const shiftZoned = toZoned(shift.startAt, location.timezone);
    const startDate = shiftZoned.startOf("day").toJSDate();

    // Find which day index (0=Monday, 6=Sunday) this shift starts on
    let dayIndex = -1;
    for (let i = 0; i < 7; i++) {
      const dayStart = new Date(weekStart);
      dayStart.setDate(dayStart.getDate() + i);
      if (
        startDate.getFullYear() === dayStart.getFullYear() &&
        startDate.getMonth() === dayStart.getMonth() &&
        startDate.getDate() === dayStart.getDate()
      ) {
        dayIndex = i;
        break;
      }
    }

    if (dayIndex !== -1) {
      shiftsByDay[dayIndex].push(shift);
    }
  });

  // Sort shifts within each day by start time
  Object.values(shiftsByDay).forEach((dayShifts) => {
    dayShifts.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  });

  const todayKey = localDateKey(new Date(), location.timezone);

  return (
    // A hardcoded 7-column grid has no room to breathe below ~700px --
    // each day column collapsed to a sliver and forced the whole page to
    // scroll horizontally on mobile. Stepping the column count down by
    // breakpoint keeps every day readable at every width, at the cost of
    // the full week only being visible "at a glance" at lg+ (1024px).
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
      {DAYS_OF_WEEK.map((day, dayIndex) => {
        const dayShifts = shiftsByDay[dayIndex];
        const dayDate = new Date(weekStart);
        dayDate.setDate(dayDate.getDate() + dayIndex);
        const dateStr = dayDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const isToday = localDateKey(dayDate, location.timezone) === todayKey;

        return (
          <div
            key={dayIndex}
            className={`flex flex-col gap-2 rounded-lg border p-3 ${
              isToday ? "border-accent/40 bg-accent-subtle/40" : "border-border-subtle bg-white"
            }`}
          >
            <div
              className={`flex items-center justify-between border-b pb-2 ${
                isToday ? "border-accent/30" : "border-border-subtle"
              }`}
              title={day}
            >
              <h3 className={`text-sm font-semibold ${isToday ? "text-accent" : "text-gray-900"}`}>
                {DAY_ABBREV[day]}
                {isToday && <span className="ml-1 text-[10px] font-normal">· Today</span>}
              </h3>
              <span className="text-xs text-gray-500">{dateStr}</span>
            </div>
            <div className="flex flex-col gap-2">
              {dayShifts.length === 0 ? (
                <div className="rounded border border-dashed border-gray-200 py-4 text-center text-xs text-gray-400">
                  No shifts
                </div>
              ) : (
                dayShifts.map((shift) => <ShiftCard key={shift.id} shift={shift} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
