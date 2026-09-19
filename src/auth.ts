import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyCredentials } from "@/lib/auth-credentials";

// Exported separately (rather than inlined into the NextAuth() call below) so
// the `jwt`/`session` callbacks can be unit tested directly, without booting
// the full Auth.js request pipeline. See auth.test.ts.
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) =>
        verifyCredentials(credentials?.email, credentials?.password),
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.role = token.role;
      // `token.sub` is set by Auth.js to the user's id on sign-in. It's typed
      // optional on JWT (a session-less JWT strategy could lack it), so guard
      // rather than assert it away; in practice for our Credentials + JWT
      // session setup it is always present once a user has signed in.
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);
