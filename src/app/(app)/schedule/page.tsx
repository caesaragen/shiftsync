import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { listLocations } from "@/lib/locations";
import { listWeekShifts } from "@/lib/shifts";
import { weekBounds } from "@/lib/time/zones";
import { WeekGrid } from "./_components/WeekGrid";
import { publishWeekAction, unpublishWeekAction } from "./actions";

async function ScheduleContent({
  locationId,
  weekOfStr,
}: {
  readonly locationId: string;
  readonly weekOfStr: string;
}) {
  const user = await requireUser();
  const locations = await listLocations(user);

  const selectedLocation = locations.find((l) => l.id === locationId);
  if (!selectedLocation) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-12">
        <p className="text-red-600">Location not found or you do not have access to it.</p>
      </div>
    );
  }

  const weekOf = new Date(weekOfStr);
  if (Number.isNaN(weekOf.getTime())) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-12">
        <p className="text-red-600">Invalid week date.</p>
      </div>
    );
  }

  const shifts = await listWeekShifts(user, selectedLocation.id, weekOf);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-xl font-semibold tracking-tight">Schedule</h1>
      <p className="mt-1 text-sm text-gray-500">Manage shifts for {selectedLocation.name}</p>

      {/* Controls */}
      <div className="mt-8 flex flex-col gap-6 rounded border bg-gray-50 p-4">
        <form method="get" className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Location</span>
            <select
              name="locationId"
              defaultValue={selectedLocation.id}
              className="rounded border px-3 py-2 outline-none focus:ring-2 focus:ring-black"
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Week of</span>
            <input
              type="date"
              name="weekOf"
              defaultValue={weekOfStr}
              className="rounded border px-3 py-2 outline-none focus:ring-2 focus:ring-black"
            />
          </label>
          <button
            type="submit"
            className="rounded bg-gray-300 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-400"
          >
            Load
          </button>
        </form>

        {/* Publish/Unpublish controls */}
        <div className="flex gap-2">
          <form
            action={async () => {
              "use server";
              await publishWeekAction(selectedLocation.id, weekOfStr);
            }}
          >
            <button
              type="submit"
              className="rounded bg-black px-3 py-2 text-sm text-white hover:bg-gray-800"
            >
              Publish week
            </button>
          </form>
          <form
            action={async () => {
              "use server";
              await unpublishWeekAction(selectedLocation.id, weekOfStr);
            }}
          >
            <button
              type="submit"
              className="rounded border px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              Unpublish week
            </button>
          </form>
        </div>
      </div>

      {/* Week grid */}
      <div className="mt-8">
        <WeekGrid shifts={shifts} location={selectedLocation} weekOf={weekOf} />
      </div>
    </main>
  );
}

export default async function SchedulePage({
  searchParams,
}: {
  readonly searchParams: Promise<{ locationId?: string; weekOf?: string }>;
}) {
  const user = await requireUser();
  const locations = await listLocations(user);
  const params = await searchParams;

  // Default to first location if not specified or invalid
  let locationId = params.locationId;
  if (!locationId || !locations.some((l) => l.id === locationId)) {
    locationId = locations[0]?.id;
  }
  if (!locationId) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-12">
        <p className="text-red-600">No locations available. Please contact your administrator.</p>
      </main>
    );
  }

  // Default week to current week in the selected location's timezone
  let weekOfStr = params.weekOf;
  if (!weekOfStr) {
    const selectedLocation = locations.find((l) => l.id === locationId);
    if (selectedLocation) {
      const now = new Date();
      const { start } = weekBounds(now, selectedLocation.timezone);
      weekOfStr = start.toISOString().split("T")[0];
    } else {
      // Fallback if location not found
      const now = new Date();
      weekOfStr = now.toISOString().split("T")[0];
    }
  }

  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-6 py-12">Loading...</div>}>
      <ScheduleContent locationId={locationId} weekOfStr={weekOfStr!} />
    </Suspense>
  );
}
