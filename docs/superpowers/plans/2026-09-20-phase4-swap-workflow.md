# ShiftSync Phase 4: Swap, Drop & Coverage Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff request a shift swap or drop it for someone else to pick up, with a manager as the final gate, plus the minimal audit trail and notification center the workflow itself requires ("all parties are notified at each step" is explicit in the brief, not optional polish).

**Architecture:** A `SwapRequest` state machine (`PENDING_TARGET → PENDING_MANAGER → APPROVED/REJECTED`, or `CANCELLED`/`EXPIRED`) enforced entirely server-side. The original `ShiftAssignment` is untouched until manager approval — a pending swap changes nothing about who is actually working. A `Notification` row is written inside the same transaction as every state transition, never as an afterthought. An `AuditLog` row is written for every mutating action across shifts, assignments, and swaps (bundling the brief's audit-trail requirement into this phase, since swap approval is the first place "who did what and why" becomes essential to get right).

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Tailwind v4, Prisma, Vitest + Testing Library, Playwright.

**Spec:** [docs/superpowers/specs/2026-09-19-shiftsync-design.md](../specs/2026-09-19-shiftsync-design.md)

## Global Constraints

- TypeScript only, `strict: true`, no `any` without an explicit inline justification comment.
- Server Components by default; `'use client'` only where interactivity genuinely requires it.
- **Every Server Action calls its role/ownership check FIRST, outside any try/catch.**
- Every Prisma `DateTime` is `@db.Timestamptz(3)`.
- **Never construct a `Date` from a bare string outside `src/lib/time/*`.** This exact bug shape (a date parsed in an ambient/implicit timezone instead of an explicit one) recurred seven times in Phase 3. If a new date needs parsing, add or reuse a helper in `src/lib/time/zones.ts` — do not inline `new Date(someString)` in a Server Action, page, or lib function.
- All state-transition writes for a `SwapRequest` (state change + notification + audit log) happen inside one transaction — a swap that "succeeded" with no notification sent, or a notification sent for a write that then failed, is a defect.
- TDD; tests verify real behavior.
- Files small and single-responsibility (~150–200 lines is the split signal).
- Conventional Commits. Never commit to `main`.
- `npm run lint` must end at 0 errors and 0 warnings.
- Verification order: `npm test` → `npm run build` → `npx tsc --noEmit` → `npm run lint`.
- **Every UI task in this phase must be verified live** — start the dev server, actually drive the flow, and where a Prisma write is claimed, confirm it with a direct database query. Given this project's track record (every UI-touching phase so far has shipped at least one bug invisible to code review or mocked tests), this is not optional.
- Do NOT run `prisma migrate reset`.
- CI is manual-trigger only (GitHub Actions billing lock); local checks are the gate.

## Carried-forward context

- `src/lib/authz.ts` — `requireUser`, `requireRole`, `visibleLocationScope`, `canSeeLocation`, `assertCanManageLocation`, `SessionUser`.
- `src/lib/shifts.ts` — `getShift`, `listWeekShifts`, `isWithinEditCutoff`, `EDIT_CUTOFF_HOURS`.
- `src/lib/time/zones.ts` — `parseDateOnly`, `parseLocalDateTime`, `localDateKey`, `weekBounds`, `toZoned`, `addLocalDays`.
- `src/lib/time/format.ts` — `zoneAbbrev`, `formatInstantClock` (derived zone labels, never hardcoded).
- `Shift`, `ShiftAssignment` models (Phase 2); `assignStaffToShift` in `src/lib/assign.ts` (SERIALIZABLE transaction, bounded retry, explicit 15s timeout).
- Scheduling UI (Phase 3): `/schedule`, `/schedule/[shiftId]` with `AssignmentPanel`, `ViolationList`.
- Seeded accounts: 1 ADMIN, 2 MANAGER, 7 STAFF — check `prisma/seed.ts` for exact emails/passwords rather than guessing.

## Design decisions this phase locks in

Resolve these against the brief's explicit edge cases (§3):

1. **Original assignment remains until manager approval** (brief, verbatim). A pending swap/drop never changes `ShiftAssignment` — only `SwapRequest.status` moves. The constraint engine's view of "who is working this shift" is unaffected by a pending request.
2. **Auto-cancel on shift edit**: if a manager edits a shift (time, skill, headcount) that has a `PENDING_TARGET` or `PENDING_MANAGER` swap request against it, that request transitions to `CANCELLED` and both parties are notified, in the same transaction as the edit. "Editing" here means any change to `startAt`/`endAt`/`requiredSkillId`/`headcount` via a future shift-edit action — if no shift-edit UI exists yet by the time this task runs, implement the cancellation as a function `cancelPendingSwapsForShift(shiftId, reason, tx)` that a future edit action can call, and call it from wherever the codebase currently allows a published shift's core fields to change (check `src/lib/shifts.ts` for what mutation surface exists today).
3. **Max 3 pending requests per staff member**: counts `PENDING_TARGET` + `PENDING_MANAGER` requests where the staff member is the *requester*. A drop request a staff member is merely eligible to *pick up* doesn't count against them until they act on it.
4. **Drop requests expire 24 hours before the shift starts if unclaimed.** This needs a way to transition `PENDING_TARGET` drop requests to `EXPIRED` as time passes without anyone acting — implement as a pure function `isExpired(request, shift, now)` plus a lazy-expiry check (evaluate on read: any read path that lists open drop requests filters out/updates ones past their expiry) rather than a cron job, since this project has no background job runner. State this choice and why in the README.
5. **A swap targets a *specific* staff member who must accept; a drop is open to *any* qualified staff member who picks it up.** Both funnel into the same manager-approval step once a target exists (accepted swap partner, or the staff member who picked up a drop).
6. **Who can request what**: only the currently assigned staff member (or an ADMIN/MANAGER acting on their behalf — check whether the brief implies staff self-service only; default to staff-only unless a manager-initiated swap is explicitly easy to add later) may request a swap or drop on their own assignment. A swap's target must be a staff member for whom `validateAssignment` would currently allow the assignment (skill, certification, availability, no conflicts) — reuse the Phase 2 engine, do not re-derive eligibility.

## File Structure

```
prisma/
  schema.prisma                     # + SwapRequest, Notification, AuditLog
  seed.ts                           # + a couple of demo swap/drop requests in varied states
src/lib/
  swaps.ts        swaps.test.ts     # state machine, eligibility, expiry, the 3 rules above
  notifications.ts notifications.test.ts   # create/list/mark-read, always called inside the same tx as the event that triggers it
  audit.ts        audit.test.ts     # writeAuditLog(tx, {actorId, entityType, entityId, action, before, after})
src/app/(app)/
  my-shifts/
    page.tsx                        # staff: their upcoming assignments, request swap/drop, respond to swap offers targeting them, pick up open drops
    actions.ts
  swaps/
    page.tsx                        # manager: pending requests needing approval, scoped to their locations
    actions.ts
  notifications/
    page.tsx                        # notification center: list, read/unread, mark-read
    actions.ts
  layout.tsx                        # MODIFIED: nav links to My Shifts / Swaps (managers) / a notification indicator
e2e/
  swaps.spec.ts
```

---

### Task 1: Schema — SwapRequest, Notification, AuditLog

**Files:** Modify `prisma/schema.prisma`; generated migration.

- [ ] **Step 1: Add the models**

```prisma
enum SwapType {
  SWAP
  DROP
}

enum SwapStatus {
  PENDING_TARGET
  PENDING_MANAGER
  APPROVED
  REJECTED
  CANCELLED
  EXPIRED
}

model SwapRequest {
  id                 String     @id @default(cuid())
  shiftAssignmentId  String
  requestingStaffId  String
  type               SwapType
  targetStaffId      String?
  status             SwapStatus @default(PENDING_TARGET)
  createdAt          DateTime   @default(now()) @db.Timestamptz(3)
  respondedAt        DateTime?  @db.Timestamptz(3)
  expiresAt          DateTime?  @db.Timestamptz(3)
  cancelReason       String?

  shiftAssignment ShiftAssignment @relation(fields: [shiftAssignmentId], references: [id], onDelete: Cascade)
  requestingStaff User            @relation("SwapRequester", fields: [requestingStaffId], references: [id], onDelete: Cascade)
  targetStaff     User?           @relation("SwapTarget", fields: [targetStaffId], references: [id], onDelete: Cascade)

  @@index([shiftAssignmentId, status])
  @@index([requestingStaffId, status])
  @@index([targetStaffId, status])
}

enum NotificationType {
  SWAP_REQUESTED
  SWAP_ACCEPTED
  SWAP_APPROVED
  SWAP_REJECTED
  SWAP_CANCELLED
  SWAP_EXPIRED
  DROP_PICKED_UP
}

model Notification {
  id                String           @id @default(cuid())
  userId            String
  type              NotificationType
  message           String
  relatedEntityType String
  relatedEntityId   String
  isRead            Boolean          @default(false)
  createdAt         DateTime         @default(now()) @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, isRead])
}

model AuditLog {
  id         String   @id @default(cuid())
  actorId    String
  entityType String
  entityId   String
  action     String
  beforeJson Json?
  afterJson  Json?
  createdAt  DateTime @default(now()) @db.Timestamptz(3)

  actor User @relation(fields: [actorId], references: [id], onDelete: Cascade)

  @@index([entityType, entityId])
  @@index([actorId])
}
```

Add back-relations on `User`: `swapRequestsMade SwapRequest[] @relation("SwapRequester")`, `swapRequestsTargeted SwapRequest[] @relation("SwapTarget")`, `notifications Notification[]`, `auditLogEntries AuditLog[] @relation` (name it distinctly if `User` already has an `actor`-shaped relation from elsewhere — check first). Add `swapRequests SwapRequest[]` on `ShiftAssignment`.

- [ ] **Step 2: Migrate and verify timestamptz**

```bash
npx prisma migrate dev --name swap_notification_audit
grep -i "TIMESTAMP" prisma/migrations/*_swap_notification_audit/migration.sql
```
Every instant column must read `TIMESTAMPTZ(3)`. Paste the grep output in your report.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add swap request, notification and audit log models"
```

---

### Task 2: Audit log writer

Do this first, independently — every later task in this phase depends on it, and it's small enough to get exactly right in isolation.

**Files:** Create `src/lib/audit.ts` + test.

**Interfaces:**
```ts
export async function writeAuditLog(
  tx: Prisma.TransactionClient,
  input: { actorId: string; entityType: string; entityId: string; action: string; before?: unknown; after?: unknown },
): Promise<void>;
```

- Takes a transaction client explicitly — it is only ever meant to be called from inside the same transaction as the mutation it's recording, never standalone (a standalone call would let the audit entry and the mutation it describes fall out of sync under a race or a partial failure).
- `before`/`after` are serialized as Prisma `Json` — test that a realistic object (e.g. a partial `ShiftAssignment`) round-trips correctly.

- [ ] **Steps:** failing test → run → implement → green → commit.

```bash
git commit -m "feat: add audit log writer"
```

---

### Task 3: Notification writer + reader

**Files:** Create `src/lib/notifications.ts` + test.

**Interfaces:**
```ts
export async function notify(
  tx: Prisma.TransactionClient,
  input: { userId: string; type: NotificationType; message: string; relatedEntityType: string; relatedEntityId: string },
): Promise<void>;
export async function listNotifications(user: SessionUser, opts?: { unreadOnly?: boolean }): Promise<Notification[]>;
export async function markRead(user: SessionUser, notificationId: string): Promise<void>;
export async function markAllRead(user: SessionUser): Promise<void>;
```

- `notify` takes a transaction client, same reasoning as `writeAuditLog` — a notification must be written atomically with the event it announces.
- `markRead`/`markAllRead` must verify the notification belongs to `user` before mutating it — a test must prove one user cannot mark another user's notification read (assert the update was scoped by `userId` in the query, not just checked after the fact).

- [ ] **Steps:** failing tests → run → implement → green → commit.

```bash
git commit -m "feat: add notification writer and reader"
```

---

### Task 4: Swap state machine — the core logic

**Files:** Create `src/lib/swaps.ts` + test.

This is the heart of the phase. Read design decisions 1–6 above before writing a line of code.

**Interfaces:**
```ts
export class SwapValidationError extends Error {}

export async function requestSwap(input: {
  requesterId: string; shiftAssignmentId: string; targetStaffId: string;
}): Promise<{ swapRequestId: string }>;

export async function requestDrop(input: {
  requesterId: string; shiftAssignmentId: string;
}): Promise<{ swapRequestId: string }>;

export async function respondToSwap(input: {
  respondingStaffId: string; swapRequestId: string; accept: boolean;
}): Promise<void>;  // PENDING_TARGET -> PENDING_MANAGER (accept) or REJECTED (decline)

export async function pickUpDrop(input: {
  staffId: string; swapRequestId: string;
}): Promise<void>;  // open DROP -> PENDING_MANAGER, targetStaffId set to staffId

export async function managerDecide(input: {
  managerId: string; swapRequestId: string; approve: boolean;
}): Promise<void>;  // PENDING_MANAGER -> APPROVED (also flips the real ShiftAssignment) or REJECTED

export function listOpenDrops(locationId: string, forStaffId: string): Promise<SwapRequestWithDetail[]>;
  // open (PENDING_TARGET, type DROP, not expired) requests at locations forStaffId is certified for and eligible to cover
```

Required behavior, each with a dedicated test:

- **`requestSwap`/`requestDrop`**: reject if the requester isn't the actual assignee of `shiftAssignmentId` (assert no write on rejection). Reject if the requester already has 3 pending requests (design decision 3) — write a test with exactly 3 existing pending requests confirming the 4th is rejected, and exactly 2 confirming a 3rd succeeds (boundary, both sides). For `requestSwap`, reject up front if `targetStaffId` would not currently pass `validateAssignment` for that shift (reuse `loadContext`+`validateAssignment` from `src/lib/constraints/engine.ts` — do not re-derive eligibility rules here).
- **`respondToSwap`**: only the actual `targetStaffId` may respond (assert rejection for anyone else, no write). Declining sets `REJECTED` and notifies the requester. Accepting sets `PENDING_MANAGER` and notifies the location's manager(s).
- **`pickUpDrop`**: only for `type: DROP`, `status: PENDING_TARGET`, not expired (design decision 4) — a test must prove an expired drop cannot be picked up, and that picking it up runs the SAME eligibility check `requestSwap` does (a person who isn't actually qualified for the shift can't pick it up either).
- **`managerDecide`**: only a manager of the shift's location (or ADMIN) may decide — reuse `assertCanManageLocation`. Approving does THREE things atomically in one transaction: flips the real `ShiftAssignment` (for a swap: reassign `staffId` from requester to target; for a drop: same), sets `SwapRequest.status = APPROVED`, writes an audit log entry, and notifies both parties. Rejecting only updates the request and notifies. **This transaction must re-validate the assignment change against the constraint engine at approval time, not just at request time** — the world may have changed between request and approval (the target could have picked up a conflicting shift in the meantime). If the now-invalid assignment would violate a BLOCK rule, the approval must fail with a clear error, not silently approve a now-broken schedule.
- **Auto-cancel** (design decision 2): implement `cancelPendingSwapsForShift(shiftId, reason, tx)` and call it from wherever a published shift's core fields can currently be edited — check `src/lib/shifts.ts` for the current mutation surface (Phase 3 may not have a general shift-edit action yet; if not, still build and test the function, and note in your report exactly where a future edit action must call it).
- **Expiry** (design decision 4): `listOpenDrops` and any other read of pending drop requests must filter out/lazily transition ones whose `expiresAt` has passed. A test must construct a request with `expiresAt` in the past and confirm it does not appear as pickable, and (your choice, documented) either confirm its status actually gets updated to `EXPIRED` on that read or confirm it's excluded without a status flip — pick one, be consistent, and say why in the report.

- [ ] **Steps:** write the tests for every bullet above FIRST, run them, watch them fail, implement, watch them pass, then commit. This task is large enough that multiple commits (one per major function) is preferable to one giant commit.

---

### Task 5: Staff-facing "My Shifts" page

**Files:** Create `src/app/(app)/my-shifts/page.tsx`, `actions.ts`.

- Lists the signed-in staff member's upcoming assignments (reuse the read pattern `getShift`/`listWeekShifts` already establish for scoping).
- For each assignment: a "Request swap" control (pick a target from staff eligible for that shift — reuse the same candidate-enumeration pattern `schedule/[shiftId]/page.tsx` uses) and a "Drop this shift" control.
- A section for swap offers *targeting* this staff member, with accept/decline.
- A section for open drops this staff member is eligible to pick up (`listOpenDrops`).
- Every mutating action authorizes via `requireUser` + an ownership check (the assignment must actually belong to the signed-in staff member) before any other work, outside any try/catch.
- Restrained styling matching the rest of the app.

- [ ] **Steps:** build → **verify live**: sign in as a real seeded staff member, actually request a swap against a real seeded shift, confirm the request lands in the database with the right state → commit.

---

### Task 6: Manager-facing swap approval queue

**Files:** Create `src/app/(app)/swaps/page.tsx`, `actions.ts`.

- Lists `PENDING_MANAGER` requests scoped to locations the signed-in manager manages (ADMIN sees all).
- Approve/reject controls calling `managerDecide`. On approval failure (re-validation caught a new conflict), show the real violation message, not a generic error — reuse `ViolationList` if the shape fits, or a minimal equivalent.
- Restrained styling.

- [ ] **Steps:** build → **verify live**: as a seeded manager, approve a real pending request end-to-end and confirm via direct database query that the `ShiftAssignment` actually flipped to the new staff member → commit.

---

### Task 7: Notification center

**Files:** Create `src/app/(app)/notifications/page.tsx`, `actions.ts`. Modify `src/app/(app)/layout.tsx` for a nav link (and, if cheap, an unread-count indicator — don't over-invest in real-time here, a per-page-load count is fine; live push is a later phase).

- [ ] **Steps:** build → verify live (trigger a real notification via a swap action in another tab/session, confirm it appears and can be marked read) → commit.

---

### Task 8: Seed data + evaluation-scenario coverage

**Files:** Modify `prisma/seed.ts`; create `src/lib/swaps.scenarios.test.ts` (or extend the existing Phase 2 scenarios file).

- Seed 2–3 swap/drop requests in varied states (one `PENDING_TARGET` swap awaiting a response, one `PENDING_MANAGER` awaiting approval, one `EXPIRED` drop) so the UI has real data to demonstrate.
- Write the brief's **Regret Swap** scenario as a real test: Staff A and B request/accept a swap, it's `PENDING_MANAGER`; Staff A wants to back out before the manager decides. Since accepting already moved status to `PENDING_MANAGER` and the brief calls this ambiguous, DECIDE and test one behavior — e.g. the requester can cancel their own request up to `PENDING_MANAGER` but not after `APPROVED`. Add a `cancelSwap` function if this decision requires one not yet in Task 4's interface list, and document the decision in the README's ambiguity-decisions section.

- [ ] **Steps:** seed idempotently, run twice, confirm stable counts → write the scenario test → verify → commit.

---

### Task 9: End-to-end coverage

**Files:** Create `e2e/swaps.spec.ts`.

Cover: staff requests a swap → target accepts → manager approves → confirm the roster on `/schedule/[shiftId]` reflects the new assignment. And: a drop request → another staff member picks it up → manager approves.

Self-cleaning against the live shared database, following the established `admin-crud.spec.ts`/`scheduling.spec.ts` pattern exactly — this is now the third E2E file sharing that pattern, don't invent a fourth variant.

- [ ] **Steps:** write → run for real, report real pass/fail → verify database is clean afterward → commit.

---

### Task 10: Documentation

**Files:** Modify `README.md`.

- Update status, add this phase's design decisions (§ above) to the ambiguity-decisions section, update Known limitations (no background job runner → expiry is lazy/read-time, not a cron; no push notifications, the notification center is pull/page-load only).
- Verify every claim against the actual shipped code before writing it, per this project's established standard.

---

## Self-Review Notes

- **Spec coverage:** implements the brief's §"Shift Swapping & Coverage" in full, including all three named edge cases, plus a minimal but real slice of §"Audit Trail" (per-mutation logging) and §"Notifications & Communication" (in-app, persisted, read/unread — not yet the full preference system or email simulation, which can follow later if graded separately).
- **Deliberately deferred:** real-time push (notifications are pull-on-page-load), notification preferences UI, full audit-log export/viewer (the data is captured; a dedicated admin screen to browse/export it is a Phase 5 concern alongside fairness analytics).
- **Risk to watch:** re-validation at manager-approval time is the one place this task's design goes beyond the brief's literal words to prevent a real data-integrity hole (approving a swap into a now-conflicting schedule) — Task 4 must not skip it.
