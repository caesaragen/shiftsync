import type { Shift, Location, Skill, ShiftAssignment, User } from "@prisma/client";
import { ShiftCard } from "./ShiftCard";
import { toZoned } from "@/lib/time/zones";

export type ShiftWithDetail = Shift & {
  location: Location;
  requiredSkill: Skill;
  assignments: (ShiftAssignment & { staff: User })[];
};

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

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

  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
      {DAYS_OF_WEEK.map((day, dayIndex) => {
        const dayShifts = shiftsByDay[dayIndex];
        const dayDate = new Date(weekStart);
        dayDate.setDate(dayDate.getDate() + dayIndex);
        const dateStr = dayDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });

        return (
          <div key={dayIndex} className="flex flex-col gap-2 rounded border p-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{day}</h3>
              <span className="text-xs text-gray-500">{dateStr}</span>
            </div>
            <div className="flex flex-col gap-2">
              {dayShifts.length === 0 ? (
                <p className="text-xs text-gray-400">No shifts</p>
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
