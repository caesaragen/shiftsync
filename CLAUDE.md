# AGENTS.md — Next.js Web App Development

Instructions for any AI coding agent (Claude Code, Cursor, Codex, etc.) working in this repo.
Copy into the project root. Fill in the `[Project]` section, keep everything else as standing rules.

## Project

- **Name**: [project name]
- **Purpose**: [one or two sentences]
- **Deployment target**: [Vercel / other]

## Required skills / plugins

Install before starting work:

- **Next.js/React full-stack plugin set** — `frontend-expert` (React 19, Tailwind v4, design-system integration), `nextjs-backend-engineer` (Server Actions, API routes, auth), `code-reviewer` (Next.js/React/TS quality + security review), plus testing agents below:
  `/plugin marketplace add JanSzewczyk/claude-plugins`
  Install the Next.js, testing, and code-quality plugins from that marketplace.
- **Apple Design Skill** — Human Interface Guidelines grounding for any UI/UX work (color, typography, motion, accessibility, component patterns), even on web — use it for visual/interaction decisions so the product doesn't default to generic template aesthetics:
  `/plugin marketplace add https://github.com/NutshellEngineering/apple-design-skill`
  `/plugin install apple-design-skill@apple-design-skill-marketplace`
- **TDD Guard** — enforces test-first development at the tool level (blocks implementation without a failing test first, blocks over-implementation beyond current test scope). Given this project is TDD, install this rather than relying on discipline alone:
  `/plugin marketplace add nizos/tdd-guard`
  `/plugin install tdd-guard@tdd-guard` → run `/tdd-guard:setup` (requires Node 22+, works with Vitest/Jest/Playwright)
- **GitHub** — use Claude Code's native git/`gh` CLI integration for commits, branches, PRs; connect the GitHub MCP connector if operating outside Claude Code (issue/PR management from chat).

## Language & tooling — non-negotiable

- **TypeScript only.** No `.js`/`.jsx` files in `src/`. `strict: true` in `tsconfig.json`, no `any` without an explicit inline justification comment.
- **Always initialize the project properly before writing feature code**: `create-next-app` with TypeScript + App Router, ESLint, Tailwind (if used) configured at scaffold time — not bolted on later.
- Package manager: [npm / pnpm / yarn — pick one, don't mix lockfiles]
- Formatting/linting: ESLint + Prettier, enforced via pre-commit hook (husky + lint-staged).

## Git workflow — required

- **Branch model**:
  - `main` — production. Always deployable. Merge into this **occasionally**, not per-feature — batch stable `develop` progress into deliberate releases, not continuous deployment from every merge.
  - `develop` — integration branch. **Always exists.** All feature branches merge here first. This is the default branch to branch from and the one CI runs against continuously.
  - `feature/<short-description>` — one branch per major feature or task, branched from `develop`, merged back via PR. Delete after merge.
  - `fix/<short-description>` — for bug fixes, same pattern.
- **Commit discipline**: commit and push regularly — small, atomic commits with clear messages (conventional commits style: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`), not one giant commit at the end of a session.
- **Never commit directly to `main`.** Rare direct commits to `develop` are fine for trivial fixes; anything nontrivial still gets a feature branch + PR, even solo.
- **PRs merge into `develop`**; only a deliberate release step merges `develop` → `main`.
- Initialize repo at project start: `git init`, first commit, create `develop` from `main`/`master` immediately, push both, set `develop` as the default working branch.

## TDD — required

- **Red → Green → Refactor** for all application logic: write the failing test first, write the minimal code to pass it, then refactor with tests green.
- Test types: unit tests (Vitest/Jest) for logic and hooks, component tests (Testing Library) for UI behavior, E2E (Playwright) for critical user flows.
- No feature is "done" without accompanying tests committed in the same PR — not appended later.
- TDD Guard (above) enforces this mechanically; don't disable it to move faster.

## Clean code standards

- Small, single-responsibility components and functions — if a component file exceeds ~150–200 lines, it's a signal to split it.
- No dead code, no commented-out blocks left in — delete or explain in a linked issue.
- Descriptive naming over comments explaining *what*; comments are for *why*, sparingly.
- Server Components by default; `'use client'` only where interactivity genuinely requires it.
- Co-locate related files (component + its test + its styles) rather than splitting by file type across the tree.

## Apple design guidance

- Use the Apple Design Skill for: spacing/grid decisions, color and typography scale, motion/easing curves, and accessibility (contrast, focus states, reduced-motion support) — even though this is a web app, not native iOS/macOS.
- Aim for restraint and clarity over decoration — hierarchy through type and spacing before color or shadow.
- Don't literally reskin the app as iOS/macOS chrome unless explicitly asked; the skill is for design *principles* (hierarchy, consistency, accessible defaults), not for making a web app look like a native Apple app.

## What NOT to do

- Don't scaffold with JavaScript and "convert to TypeScript later."
- Don't commit directly to `main`.
- Don't write implementation before a failing test exists.
- Don't let `develop` go stale — merge/rebase feature branches against it regularly to avoid painful conflicts later.
- Don't skip the project-initialization step and start dropping files into an ad hoc structure.

## When stuck

Prefer asking over guessing on: data model / schema decisions, auth strategy, and anything affecting the public API surface — these are expensive to change once other code depends on them.