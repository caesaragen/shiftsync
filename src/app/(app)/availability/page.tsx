import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { listMyAvailability } from "@/lib/staff-availability";
import { formatClockMinutes } from "@/lib/time/format";
import { SubmitButton } from "@/components/SubmitButton";
import { FlashToast } from "@/components/toast/FlashToast";
import {
  addRecurringWindowAction,
  addExceptionWindowAction,
  deleteAvailabilityAction,
} from "./actions";

const DAY_NAMES = [
  "", // dayOfWeek is 1-indexed (Luxon weekday: 1=Mon..7=Sun); index 0 is never used.
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

function formatDate(date: Date): string {
  // Availability.date is a pure calendar date (@db.Date, no time/zone
  // attached) -- read back out in UTC, same reasoning as dateOnlyKey in
  // src/lib/availability.ts, so it never rolls to the wrong day.
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function AvailabilityPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const user = await requireRole("STAFF");
  const { error, success } = await searchParams;

  const [rows, me] = await Promise.all([
    listMyAvailability(user.id),
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { homeTimezone: true } }),
  ]);

  const recurring = rows.filter((r) => r.kind === "RECURRING");
  const exceptions = rows.filter((r) => r.kind === "EXCEPTION");
  const recurringByDay = new Map<number, typeof recurring>();
  for (const row of recurring) {
    const day = row.dayOfWeek ?? 0;
    recurringByDay.set(day, [...(recurringByDay.get(day) ?? []), row]);
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <FlashToast error={error} success={success} />
      <h1 className="text-xl font-semibold tracking-tight">My Availability</h1>
      <p className="mt-1 text-sm text-gray-500">
        Times are in your home timezone ({me.homeTimezone}). Managers can only assign you to shifts
        that fall fully within these windows.
      </p>

      {/* Recurring weekly schedule */}
      <section className="mt-8 rounded-lg border border-border-subtle bg-surface p-5 shadow-sm">
        <h2 className="text-base font-semibold tracking-tight">Weekly schedule</h2>
        <p className="mt-1 text-sm text-gray-500">
          Recurring windows that repeat every week until you remove them.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DAY_NAMES.slice(1).map((dayName, i) => {
            const dayOfWeek = i + 1;
            const dayRows = recurringByDay.get(dayOfWeek) ?? [];
            return (
              <div
                key={dayOfWeek}
                className="rounded-lg border border-border-subtle bg-white p-3 text-sm"
              >
                <h3 className="font-medium text-gray-900">{dayName}</h3>
                {dayRows.length === 0 ? (
                  <p className="mt-2 text-xs text-gray-400">No windows</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {dayRows.map((row) => (
                      <li key={row.id} className="flex items-center justify-between gap-2">
                        <span>
                          {formatClockMinutes(row.startMinutes)}–
                          {formatClockMinutes(row.endMinutes)}
                        </span>
                        <form action={deleteAvailabilityAction}>
                          <input type="hidden" name="id" value={row.id} />
                          <SubmitButton
                            pendingText="…"
                            className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-900 disabled:opacity-60"
                          >
                            Remove
                          </SubmitButton>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        <h3 className="mt-6 text-sm font-medium text-gray-700">Add a weekly window</h3>
        <form
          action={addRecurringWindowAction}
          className="mt-3 flex flex-wrap items-end gap-3 text-sm"
        >
          <label className="flex flex-col gap-1">
            <span className="font-medium">Day</span>
            <select
              name="dayOfWeek"
              required
              defaultValue=""
              className="rounded border px-3 py-2 outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="" disabled>
                Select a day
              </option>
              {DAY_NAMES.slice(1).map((dayName, i) => (
                <option key={dayName} value={i + 1}>
                  {dayName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Start</span>
            <input
              type="time"
              name="startTime"
              required
              className="rounded border px-3 py-2 outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">End</span>
            <input
              type="time"
              name="endTime"
              required
              className="rounded border px-3 py-2 outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
          <SubmitButton
            pendingText="Adding…"
            className="rounded bg-accent px-3 py-2 text-white hover:bg-accent-hover disabled:opacity-70"
          >
            Add
          </SubmitButton>
        </form>
      </section>

      {/* One-off exceptions */}
      <section className="mt-8 rounded-lg border border-border-subtle bg-surface p-5 shadow-sm">
        <h2 className="text-base font-semibold tracking-tight">Exceptions</h2>
        <p className="mt-1 text-sm text-gray-500">
          A one-off override for a single date -- it replaces your weekly schedule for that date
          entirely, rather than adding to it. Use &ldquo;Unavailable all day&rdquo; for a day off,
          or set different hours than usual.
        </p>

        {exceptions.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">No exceptions yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {exceptions.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-white px-3 py-2.5 text-sm"
              >
                <span>
                  <span className="font-medium">{formatDate(row.date!)}</span> —{" "}
                  {row.isAvailable ? (
                    <span>
                      {formatClockMinutes(row.startMinutes)}–{formatClockMinutes(row.endMinutes)}
                    </span>
                  ) : (
                    <span className="text-gray-500">Unavailable all day</span>
                  )}
                </span>
                <form action={deleteAvailabilityAction}>
                  <input type="hidden" name="id" value={row.id} />
                  <SubmitButton
                    pendingText="Removing…"
                    className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-900 disabled:opacity-60"
                  >
                    Remove
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}

        <h3 className="mt-6 text-sm font-medium text-gray-700">Add an exception</h3>
        <form
          action={addExceptionWindowAction}
          className="mt-3 flex flex-wrap items-end gap-3 text-sm"
        >
          <label className="flex flex-col gap-1">
            <span className="font-medium">Date</span>
            <input
              type="date"
              name="date"
              required
              className="rounded border px-3 py-2 outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Start</span>
            <input
              type="time"
              name="startTime"
              className="rounded border px-3 py-2 outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">End</span>
            <input
              type="time"
              name="endTime"
              className="rounded border px-3 py-2 outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
          <label className="flex items-center gap-2 pb-2.5">
            <input
              type="checkbox"
              name="isAvailable"
              defaultChecked
              className="h-4 w-4 rounded border-gray-300"
            />
            <span>Available (uncheck for &ldquo;unavailable all day&rdquo;)</span>
          </label>
          <SubmitButton
            pendingText="Adding…"
            className="rounded bg-accent px-3 py-2 text-white hover:bg-accent-hover disabled:opacity-70"
          >
            Add
          </SubmitButton>
        </form>
      </section>
    </main>
  );
}
