import { requireRole } from "@/lib/authz";
import { listStaffAssignments } from "@/lib/staff-assignments";
import { listAllSkills } from "@/lib/skills";
import { listLocations } from "@/lib/locations";
import {
  assignSkillAction,
  removeSkillAction,
  certifyStaffAction,
  decertifyStaffAction,
} from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { FlashToast } from "@/components/toast/FlashToast";

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function AdminStaffPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const user = await requireRole("ADMIN");
  const { error, success } = await searchParams;
  const [staff, skills, locations] = await Promise.all([
    listStaffAssignments(user),
    listAllSkills(user),
    listLocations(user),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <FlashToast error={error} success={success} />
      <h1 className="text-xl font-semibold tracking-tight">Staff</h1>
      <p className="mt-1 text-sm text-gray-500">
        Skills and location certifications for staff members.
      </p>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {error}
        </p>
      )}

      {staff.length === 0 && <p className="mt-8 text-sm text-gray-500">No staff members yet.</p>}

      <ul className="mt-8 flex flex-col gap-10">
        {staff.map((member) => {
          const assignedSkillIds = new Set(member.skills.map((s) => s.id));
          const availableSkills = skills.filter((s) => !assignedSkillIds.has(s.id));
          const certifiedLocationIds = new Set(
            member.certifications.filter((c) => c.endedAt === null).map((c) => c.locationId),
          );
          const availableLocations = locations.filter((l) => !certifiedLocationIds.has(l.id));

          return (
            <li key={member.id} className="border-b pb-8 last:border-0">
              <h2 className="text-base font-semibold tracking-tight">{member.name}</h2>
              <p className="text-sm text-gray-500">{member.email}</p>

              <div className="mt-4 grid gap-8 sm:grid-cols-2">
                <section>
                  <h3 className="text-sm font-medium text-gray-700">Skills</h3>
                  <ul className="mt-2 flex flex-col gap-1 text-sm">
                    {member.skills.length === 0 && (
                      <li className="text-gray-500">No skills assigned.</li>
                    )}
                    {member.skills.map((skill) => (
                      <li key={skill.id} className="flex items-center justify-between gap-2">
                        <span>{skill.name}</span>
                        <form action={removeSkillAction}>
                          <input type="hidden" name="staffId" value={member.id} />
                          <input type="hidden" name="skillId" value={skill.id} />
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
                  {availableSkills.length > 0 && (
                    <form
                      action={assignSkillAction}
                      className="mt-3 flex items-center gap-2 text-sm"
                    >
                      <input type="hidden" name="staffId" value={member.id} />
                      <label className="sr-only" htmlFor={`skill-${member.id}`}>
                        Add a skill
                      </label>
                      <select
                        id={`skill-${member.id}`}
                        name="skillId"
                        required
                        defaultValue=""
                        className="rounded border px-2 py-1 outline-none focus:ring-2 focus:ring-accent"
                      >
                        <option value="" disabled>
                          Add a skill…
                        </option>
                        {availableSkills.map((skill) => (
                          <option key={skill.id} value={skill.id}>
                            {skill.name}
                          </option>
                        ))}
                      </select>
                      <SubmitButton
                        pendingText="Adding…"
                        className="rounded bg-accent px-2 py-1 text-white hover:bg-accent-hover disabled:opacity-70"
                      >
                        Add
                      </SubmitButton>
                    </form>
                  )}
                </section>

                <section>
                  <h3 className="text-sm font-medium text-gray-700">Location certifications</h3>
                  <ul className="mt-2 flex flex-col gap-1 text-sm">
                    {member.certifications.length === 0 && (
                      <li className="text-gray-500">No certifications yet.</li>
                    )}
                    {member.certifications.map((cert) => (
                      <li key={cert.id} className="flex items-center justify-between gap-2">
                        {cert.endedAt === null ? (
                          <>
                            <span>{cert.locationName}</span>
                            <form action={decertifyStaffAction}>
                              <input type="hidden" name="staffId" value={member.id} />
                              <input type="hidden" name="locationId" value={cert.locationId} />
                              <SubmitButton
                                pendingText="Ending…"
                                className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-900 disabled:opacity-60"
                              >
                                End certification
                              </SubmitButton>
                            </form>
                          </>
                        ) : (
                          // Ended certifications are a soft state change (the row is
                          // never deleted) and must stay visible, not hidden — shown
                          // muted with the end date so the history is auditable.
                          // gray-500, not gray-400: gray-400 on white is ~2.5:1, below
                          // WCAG AA's 4.5:1 for normal text; gray-500 is ~4.8:1.
                          <span className="text-gray-500">
                            {cert.locationName} — ended {formatDate(cert.endedAt)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {availableLocations.length > 0 && (
                    <form
                      action={certifyStaffAction}
                      className="mt-3 flex items-center gap-2 text-sm"
                    >
                      <input type="hidden" name="staffId" value={member.id} />
                      <label className="sr-only" htmlFor={`location-${member.id}`}>
                        Certify at a location
                      </label>
                      <select
                        id={`location-${member.id}`}
                        name="locationId"
                        required
                        defaultValue=""
                        className="rounded border px-2 py-1 outline-none focus:ring-2 focus:ring-accent"
                      >
                        <option value="" disabled>
                          Certify at…
                        </option>
                        {availableLocations.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.name}
                          </option>
                        ))}
                      </select>
                      <SubmitButton
                        pendingText="Certifying…"
                        className="rounded bg-accent px-2 py-1 text-white hover:bg-accent-hover disabled:opacity-70"
                      >
                        Certify
                      </SubmitButton>
                    </form>
                  )}
                </section>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
