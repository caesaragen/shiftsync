import { requireRole } from "@/lib/authz";
import { listLocations } from "@/lib/locations";
import { createLocationAction } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { FlashToast } from "@/components/toast/FlashToast";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
] as const;

export default async function AdminLocationsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const user = await requireRole("ADMIN");
  const { error, success } = await searchParams;
  const locations = await listLocations(user);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <FlashToast error={error} success={success} />
      <h1 className="text-xl font-semibold tracking-tight">Locations</h1>
      <p className="mt-1 text-sm text-gray-500">
        Coastal Eats restaurant locations and their timezones.
      </p>

      <div className="mt-8 overflow-hidden rounded-lg border border-border-subtle bg-white shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border-subtle bg-surface text-left text-gray-500">
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Timezone</th>
              <th className="px-4 py-2.5 font-medium">Address</th>
            </tr>
          </thead>
          <tbody>
            {locations.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-4 text-gray-500">
                  No locations yet.
                </td>
              </tr>
            )}
            {locations.map((location) => (
              <tr key={location.id} className="border-b border-border-subtle last:border-0">
                <td className="px-4 py-2.5 font-medium text-gray-900">{location.name}</td>
                <td className="px-4 py-2.5">{location.timezone}</td>
                <td className="px-4 py-2.5 text-gray-500">{location.address ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-8 rounded-lg border border-border-subtle bg-surface p-5 shadow-sm">
        <h2 className="text-base font-semibold tracking-tight">Add a location</h2>
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
              className="rounded border px-3 py-2 outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Timezone</span>
            <select
              name="timezone"
              required
              defaultValue=""
              className="rounded border px-3 py-2 outline-none focus:ring-2 focus:ring-accent"
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
              className="rounded border px-3 py-2 outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
          <SubmitButton
            pendingText="Adding…"
            className="rounded bg-accent px-3 py-2 text-white hover:bg-accent-hover disabled:opacity-70"
          >
            Add location
          </SubmitButton>
        </form>
      </div>
    </main>
  );
}
