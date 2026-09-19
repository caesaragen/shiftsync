import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import type { Violation } from "@/lib/constraints/types";
import type { ValidationResult } from "@/lib/constraints/engine";

// Stub the Prisma boundary: `assign.ts` only ever touches `prisma.$transaction`
// directly (everything else happens through the transaction client handed to
// the callback), so that's the only prisma surface we need here.
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: vi.fn() },
}));

// Stub the constraint engine boundary. The engine's own logic (eligibility,
// conflicts, hours) is exercised in engine.test.ts; this file only needs to
// prove that `assignStaffToShift` calls `loadContext`/`validateAssignment`
// INSIDE the transaction (with the transaction client) and reacts correctly
// to whatever they return.
vi.mock("@/lib/constraints/engine", () => ({
  loadContext: vi.fn(),
  validateAssignment: vi.fn(),
}));

const { prisma } = await import("@/lib/prisma");
const { loadContext, validateAssignment } = await import("@/lib/constraints/engine");
const { assignStaffToShift, AssignmentConflictError, AssignmentBlockedError } =
  await import("./assign");

const $transaction = vi.mocked(prisma.$transaction);
const mockedLoadContext = vi.mocked(loadContext);
const mockedValidateAssignment = vi.mocked(validateAssignment);

const baseInput = {
  staffId: "staff-1",
  shiftId: "shift-1",
  assignedById: "manager-1",
};

// A distinguishable stand-in for the real EngineContext -- assign.ts treats
// it as opaque and just passes it straight to validateAssignment, so its
// exact shape doesn't matter for these tests.
const fakeCtx = { marker: "ctx" } as never;

function allowedResult(overrides: Partial<ValidationResult> = {}): ValidationResult {
  return { allowed: true, requiresOverride: false, violations: [], ...overrides };
}

function blockResult(violations: Violation[]): ValidationResult {
  return { allowed: false, requiresOverride: false, violations };
}

function overrideRequiredResult(violations: Violation[]): ValidationResult {
  return { allowed: true, requiresOverride: true, violations };
}

/** Builds a fake transaction client exposing only what assign.ts touches. */
function makeTx(createImpl?: (...args: unknown[]) => unknown) {
  return {
    shiftAssignment: {
      create: vi.fn(createImpl ?? (async () => ({ id: "assignment-1" }))),
    },
  };
}

/** Makes `prisma.$transaction` invoke the callback with `tx` and capture options. */
function wireTransaction(tx: ReturnType<typeof makeTx>) {
  const capturedOptions: unknown[] = [];
  $transaction.mockImplementation(async (fn: unknown, options?: unknown) => {
    capturedOptions.push(options);
    return (fn as (tx: unknown) => unknown)(tx);
  });
  return capturedOptions;
}

function p2034() {
  return new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict", {
    code: "P2034",
    clientVersion: "6.19.3",
  });
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.19.3",
    meta: { target: ["shiftId", "staffId"] },
  });
}

beforeEach(() => {
  $transaction.mockReset();
  mockedLoadContext.mockReset();
  mockedValidateAssignment.mockReset();
  mockedLoadContext.mockResolvedValue(fakeCtx);
});

describe("assignStaffToShift", () => {
  it("writes the assignment and returns its id on the happy path", async () => {
    const tx = makeTx();
    const capturedOptions = wireTransaction(tx);
    mockedValidateAssignment.mockReturnValue(allowedResult());

    const result = await assignStaffToShift(baseInput);

    expect(result).toEqual({ assignmentId: "assignment-1" });
    expect(tx.shiftAssignment.create).toHaveBeenCalledTimes(1);
    // loadContext must run with the TRANSACTION client, not the global
    // singleton -- that's what makes the read and the write part of the
    // same serializable transaction.
    expect(mockedLoadContext).toHaveBeenCalledWith("staff-1", "shift-1", tx);
    // The whole point of this task: the isolation level must actually be
    // Serializable, not just "some transaction".
    expect(capturedOptions[0]).toMatchObject({ isolationLevel: "Serializable" });
  });

  it("throws AssignmentBlockedError with violations and never writes on a BLOCK", async () => {
    const tx = makeTx();
    wireTransaction(tx);
    const violations: Violation[] = [
      { rule: "SKILL_MISMATCH", severity: "BLOCK", message: "Staff lacks required skill" },
    ];
    mockedValidateAssignment.mockReturnValue(blockResult(violations));

    await expect(assignStaffToShift(baseInput)).rejects.toBeInstanceOf(AssignmentBlockedError);
    await expect(assignStaffToShift(baseInput)).rejects.toMatchObject({ violations });
    expect(tx.shiftAssignment.create).not.toHaveBeenCalled();
  });

  it("throws AssignmentBlockedError and does not write when OVERRIDE_REQUIRED has no reason", async () => {
    const tx = makeTx();
    wireTransaction(tx);
    const violations: Violation[] = [
      {
        rule: "SEVEN_CONSECUTIVE_DAYS",
        severity: "OVERRIDE_REQUIRED",
        message: "7th consecutive day",
      },
    ];
    mockedValidateAssignment.mockReturnValue(overrideRequiredResult(violations));

    await expect(assignStaffToShift(baseInput)).rejects.toBeInstanceOf(AssignmentBlockedError);
    expect(tx.shiftAssignment.create).not.toHaveBeenCalled();
  });

  it("writes and persists overrideReason when OVERRIDE_REQUIRED has a reason", async () => {
    const tx = makeTx();
    wireTransaction(tx);
    const violations: Violation[] = [
      {
        rule: "SEVEN_CONSECUTIVE_DAYS",
        severity: "OVERRIDE_REQUIRED",
        message: "7th consecutive day",
      },
    ];
    mockedValidateAssignment.mockReturnValue(overrideRequiredResult(violations));

    const result = await assignStaffToShift({
      ...baseInput,
      overrideReason: "Approved by ops director",
    });

    expect(result).toEqual({ assignmentId: "assignment-1" });
    expect(tx.shiftAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ overrideReason: "Approved by ops director" }),
      }),
    );
  });

  it("retries once on P2034 and succeeds on the second attempt", async () => {
    const tx = makeTx();
    mockedValidateAssignment.mockReturnValue(allowedResult());
    let call = 0;
    $transaction.mockImplementation(async (fn: unknown) => {
      call += 1;
      if (call === 1) throw p2034();
      return (fn as (tx: unknown) => unknown)(tx);
    });

    const result = await assignStaffToShift(baseInput);

    expect(result).toEqual({ assignmentId: "assignment-1" });
    expect($transaction).toHaveBeenCalledTimes(2);
  });

  it("throws AssignmentConflictError after exhausting retries on repeated P2034", async () => {
    $transaction.mockImplementation(async () => {
      throw p2034();
    });

    await expect(assignStaffToShift(baseInput)).rejects.toBeInstanceOf(AssignmentConflictError);
    // 1 initial attempt + 2 retries = 3 total calls.
    expect($transaction).toHaveBeenCalledTimes(3);
  });

  it("maps a P2002 unique-constraint violation to AssignmentConflictError, not a raw Prisma error", async () => {
    const tx = makeTx(async () => {
      throw p2002();
    });
    wireTransaction(tx);
    mockedValidateAssignment.mockReturnValue(allowedResult());

    const error = await assignStaffToShift(baseInput).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AssignmentConflictError);
    expect(error).not.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    // A P2002 is a definitive "someone else won" -- it must NOT be retried
    // as if it were a transient serialization failure.
    expect($transaction).toHaveBeenCalledTimes(1);
  });
});
