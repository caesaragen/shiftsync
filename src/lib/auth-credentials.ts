import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";

export interface AuthorizedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

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
  if (!user) return null;

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return null;

  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
