import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";

export interface AuthorizedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

// A precomputed bcrypt hash of an unguessable value, with no corresponding
// user. On the "email not found" path we still `verifyPassword` against
// this so that path costs roughly the same bcrypt work as a real wrong-
// password comparison — otherwise a timing difference between "no such
// user" (fast) and "wrong password" (slow, ~100ms of bcrypt) becomes an
// oracle for enumerating which work emails have accounts. This is
// best-effort, NOT a constant-time guarantee (network jitter, GC pauses,
// and Prisma's own lookup latency remain observable) — do not "optimize"
// this dummy comparison away.
const DUMMY_HASH = "$2b$10$DBE.SrvD.840d0pDhsw1jOrm/ivndFTvqrwDiIbHcxcCP7Zfb39YW";

/**
 * Verifies a Credentials-provider sign-in attempt against the User table.
 *
 * `email`/`password` are typed `unknown` because Auth.js does not validate
 * the shape of the credentials object before calling `authorize()` — a
 * crafted request can send any JSON value for either field. This function
 * must fail closed (return `null`) rather than throw for any bad input,
 * since a thrown error would break the authorize() contract every other
 * phase of this app relies on.
 */
export async function verifyCredentials(
  email: unknown,
  password: unknown,
): Promise<AuthorizedUser | null> {
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return null;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // Pay the same bcrypt cost as a real wrong-password check — see
    // DUMMY_HASH above for why.
    await verifyPassword(password, DUMMY_HASH);
    return null;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return null;

  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
