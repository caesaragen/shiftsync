import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      role: Role;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
  }
}

// `next-auth/jwt` re-exports (`export *`) rather than declaring `JWT` locally, so
// augmenting that specifier does not merge into the type Auth.js actually uses
// internally (`@auth/core/index.d.ts` imports `JWT` from `./jwt.js`). Augment the
// underlying module directly so `token.role` is typed in the `jwt`/`session` callbacks.
declare module "@auth/core/jwt" {
  interface JWT {
    role: Role;
  }
}
