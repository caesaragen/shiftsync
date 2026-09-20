import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

async function login(formData: FormData) {
  "use server";
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect("/login?error=invalid");
    }
    throw error;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-6">
      <form
        action={login}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-border-subtle bg-white p-8 shadow-sm"
      >
        <div className="mb-2 flex flex-col items-center gap-2 text-center">
          <span
            aria-hidden
            className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-sm font-bold text-white"
          >
            S
          </span>
          <h1 className="text-xl font-semibold tracking-tight">Sign in to ShiftSync</h1>
        </div>
        {error === "invalid" && (
          <p role="alert" className="text-sm text-red-600">
            Invalid email or password.
          </p>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span>Email</span>
          <input
            name="email"
            type="email"
            placeholder="Email"
            required
            className="rounded border px-3 py-2 outline-none focus:ring-2 focus:ring-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Password</span>
          <input
            name="password"
            type="password"
            placeholder="Password"
            required
            className="rounded border px-3 py-2 outline-none focus:ring-2 focus:ring-accent"
          />
        </label>
        <button
          type="submit"
          className="mt-2 rounded bg-accent px-3 py-2 text-white hover:bg-accent-hover"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
