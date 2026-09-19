import { requireUser, type SessionUser } from "@/lib/authz";
import { listLocations } from "@/lib/locations";
import { listAllSkills } from "@/lib/skills";
import { listStaffAssignments } from "@/lib/staff-assignments";

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <main className="mx-auto mt-16 max-w-2xl px-6">
      <p>Signed in as {user.name}</p>
      <p className="text-sm text-gray-500">{user.role}</p>

      <div className="mt-10">
        {user.role === "ADMIN" && <AdminOverview user={user} />}
        {user.role === "MANAGER" && <ManagerOverview user={user} />}
        {user.role === "STAFF" && <StaffOverview user={user} />}
      </div>
    </main>
  );
}

async function AdminOverview({ user }: { user: SessionUser }) {
  const [locations, skills, staff] = await Promise.all([
    listLocations(user),
    listAllSkills(user),
    listStaffAssignments(user),
  ]);

  const stats = [
    { label: "Locations", count: locations.length },
    { label: "Skills", count: skills.length },
    { label: "Staff", count: staff.length },
  ];

  return (
    <section>
      <h2 className="text-sm font-medium text-gray-700">Organization overview</h2>
      <dl className="mt-3 grid grid-cols-3 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded border px-4 py-3">
            <dt className="text-xs text-gray-500">{stat.label}</dt>
            <dd className="mt-1 text-xl font-semibold tracking-tight">{stat.count}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

async function ManagerOverview({ user }: { user: SessionUser }) {
  const locations = await listLocations(user);

  return (
    <section>
      {/* Deliberately not "Locations" (or containing it as a substring) —
          the admin Locations page's e2e authorization spec asserts a
          MANAGER/STAFF landing on /dashboard sees NO heading matching
          "Locations", as the discriminating signal that they were truly
          redirected away from the admin page rather than merely URL-
          matched. A heading here with "Locations" in it would satisfy
          that assertion by accident and mask a real redirect failure. */}
      <h2 className="text-sm font-medium text-gray-700">Where you manage</h2>
      {locations.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">No locations assigned yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {locations.map((location) => (
            <li key={location.id} className="rounded border px-4 py-3">
              <span className="font-medium">{location.name}</span>
              <span className="text-gray-500"> — {location.timezone}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function StaffOverview({ user }: { user: SessionUser }) {
  const [me] = await listStaffAssignments(user);
  const activeCertifications = (me?.certifications ?? []).filter((cert) => cert.endedAt === null);
  const skills = me?.skills ?? [];

  return (
    <div className="flex flex-col gap-8">
      <section>
        {/* See the comment in ManagerOverview above — kept off the word
            "Locations" so it can never accidentally satisfy the admin
            Locations page's "no such heading here" e2e assertion. */}
        <h2 className="text-sm font-medium text-gray-700">Where you&apos;re certified</h2>
        {activeCertifications.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">Not currently certified at any location.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {activeCertifications.map((cert) => (
              <li key={cert.id} className="rounded border px-4 py-3">
                {cert.locationName}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-gray-700">Your skills</h2>
        {skills.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">No skills assigned yet.</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2 text-sm">
            {skills.map((skill) => (
              <li key={skill.id} className="rounded-full border px-3 py-1">
                {skill.name}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
