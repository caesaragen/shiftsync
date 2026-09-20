import { requireRole } from "@/lib/authz";
import { listAllSkills } from "@/lib/skills";
import { createSkillAction } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { FlashToast } from "@/components/toast/FlashToast";

export default async function AdminSkillsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const user = await requireRole("ADMIN");
  const { error, success } = await searchParams;
  const skills = await listAllSkills(user);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <FlashToast error={error} success={success} />
      <h1 className="text-xl font-semibold tracking-tight">Skills</h1>
      <p className="mt-1 text-sm text-gray-500">
        Skills staff can be certified in and scheduled against.
      </p>

      <div className="mt-8 overflow-hidden rounded-lg border border-border-subtle bg-white shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border-subtle bg-surface text-left text-gray-500">
              <th className="px-4 py-2.5 font-medium">Name</th>
            </tr>
          </thead>
          <tbody>
            {skills.length === 0 && (
              <tr>
                <td className="px-4 py-4 text-gray-500">No skills yet.</td>
              </tr>
            )}
            {skills.map((skill) => (
              <tr key={skill.id} className="border-b border-border-subtle last:border-0">
                <td className="px-4 py-2.5 font-medium text-gray-900">{skill.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-8 rounded-lg border border-border-subtle bg-surface p-5 shadow-sm">
        <h2 className="text-base font-semibold tracking-tight">Add a skill</h2>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}
        <form action={createSkillAction} className="mt-4 flex max-w-sm flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span>Name</span>
            <input
              name="name"
              type="text"
              required
              className="rounded border px-3 py-2 outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
          <SubmitButton
            pendingText="Adding…"
            className="rounded bg-accent px-3 py-2 text-white hover:bg-accent-hover disabled:opacity-70"
          >
            Add skill
          </SubmitButton>
        </form>
      </div>
    </main>
  );
}
