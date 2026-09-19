import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: "http://localhost:3000",
  },
  // There is no separate test database (see README's Known limitations):
  // these specs run against the same live, remote Supabase Postgres the
  // demo app uses, with real network round-trips on every auth check and
  // every DB-backed page render — plus dev-mode Turbopack's on-demand
  // per-route compile on first hit. Playwright's 5s default `expect`
  // timeout was tuned for a local/mocked backend and is too tight for
  // that combination now that the dashboard (login's redirect target)
  // does real DB reads for every role. This doesn't loosen what's
  // asserted, only how long a genuinely slow — not broken — round trip is
  // given to finish.
  expect: { timeout: 15_000 },
});
