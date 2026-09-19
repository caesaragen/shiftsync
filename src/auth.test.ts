import { describe, it, expect } from "vitest";
import type { Session } from "next-auth";
import type { JWT } from "@auth/core/jwt";
import { authConfig } from "./auth";

// Regression test for the `session.user.id` gap: `requireUser()` (src/lib/authz.ts)
// reads `session.user.id`, which only exists because the `session` callback below
// copies `token.sub` onto it. Exercise that callback directly — Auth.js's callbacks
// are plain functions of (session, token) => session with no hidden request-scoped
// state, so this is a faithful unit test without booting the HTTP pipeline.
const sessionCallback = authConfig.callbacks?.session;
if (!sessionCallback) {
  throw new Error("authConfig.callbacks.session is not configured — cannot test it");
}

// next-auth's own declared type for the `session` callback parameter is an
// *intersection* of the "database" and "jwt" strategy shapes (see
// @auth/core/index.d.ts), so it requires a top-level `user: AdapterUser`
// field even though `authConfig` is configured with `session.strategy:
// "jwt"`, under which Auth.js never actually supplies that field — only
// `session` and `token` are passed at runtime. Rather than fabricate an
// unused `AdapterUser` just to satisfy an upstream type that overclaims
// what's required, assert the literal (which has exactly the fields real
// jwt-strategy calls receive) to the declared parameter type.
type SessionCallbackArgs = Parameters<typeof sessionCallback>[0];

function makeSession(id: string): Session {
  return {
    user: { id, name: "Alex Admin", email: "alex@x.test", role: "ADMIN" },
    expires: new Date(Date.now() + 60_000).toISOString(),
  };
}

describe("authConfig session callback", () => {
  it("carries a non-empty user id from token.sub onto the session", async () => {
    const token = { sub: "user-123", role: "ADMIN" } as JWT;
    const args = {
      session: makeSession(""),
      token,
      newSession: undefined,
      trigger: undefined,
    } as SessionCallbackArgs;
    const result = await sessionCallback(args);

    expect(result.user?.id).toBe("user-123");
    expect(result.user?.id).not.toBe("");
  });

  it("leaves session.user.id as-is when token.sub is absent (defensive branch)", async () => {
    const token = { role: "STAFF" } as JWT;
    const args = {
      session: makeSession(""),
      token,
      newSession: undefined,
      trigger: undefined,
    } as SessionCallbackArgs;
    const result = await sessionCallback(args);

    expect(result.user?.id).toBe("");
  });
});
