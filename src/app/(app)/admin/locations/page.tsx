import { requireRole } from "@/lib/authz";
import { listLocations } from "@/lib/locations";
import { createLocationAction } from "./actions";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
] as const;

export default async function AdminLocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireRole("ADMIN");
  const { error } = await searchParams;
  const locations = await listLocations(user);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-xl font-semibold tracking-tight">Locations</h1>
      <p className="mt-1 text-sm text-gray-500">
        Coastal Eats restaurant locations and their timezones.
      </p>

      <table className="mt-8 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium">Timezone</th>
            <th className="py-2 pr-4 font-medium">Address</th>
          </tr>
        </thead>
        <tbody>
          {locations.length === 0 && (
            <tr>
              <td colSpan={3} className="py-4 text-gray-500">
                No locations yet.
              </td>
            </tr>
          )}
          {locations.map((location) => (
            <tr key={location.id} className="border-b last:border-0">
              <td className="py-2 pr-4">{location.name}</td>
              <td className="py-2 pr-4">{location.timezone}</td>
              <td className="py-2 pr-4 text-gray-500">{location.address ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-12 text-base font-semibold tracking-tight">Add a location</h2>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
      <form action={createLocationAction} className="mt-4 flex max-w-sm flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span>Name</span>
          <input
            name="name"
            type="text"
            required
            className="rounded border px-3 py-2 outline-none focus:ring-2 focus:ring-black"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Timezone</span>
          <select
            name="timezone"
            required
            defaultValue=""
            className="rounded border px-3 py-2 outline-none focus:ring-2 focus:ring-black"
          >
            <option value="" disabled>
              Select a timezone
            </option>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Address (optional)</span>
          <input
            name="address"
            type="text"
            className="rounded border px-3 py-2 outline-none focus:ring-2 focus:ring-black"
          />
        </label>
        <button type="submit" className="rounded bg-black px-3 py-2 text-white">
          Add location
        </button>
      </form>
    </main>
  );
}
