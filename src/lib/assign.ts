import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadContext, validateAssignment } from "@/lib/constraints/engine";
import type { Violation } from "@/lib/constraints/types";

/**
 * Thrown when the operation could not complete because of a genuine race
 * with another concurrent assignment: a Postgres serialization failure that
 * persisted through all retries, or a unique-constraint hit on
 * `@@unique([shiftId, staffId])` (someone else assigned this exact pair
 * first). Safe for the caller to retry the whole operation or refresh and
 * re-check -- it does NOT mean the assignment itself is invalid.
 */
export class AssignmentConflictError extends Error {
  constructor(
    message = "This assignment could not be completed due to a concurrent change. Please refresh and try again.",
  ) {
    super(message);
    this.name = "AssignmentConflictError";
  }
}

/**
 * Thrown when the constraint engine blocks the assignment (a BLOCK
 * violation), or when an OVERRIDE_REQUIRED violation exists and no
 * `overrideReason` was supplied. Carries the violations so the caller can
 * render them to the manager.
 */
export class AssignmentBlockedError extends Error {
  constructor(
    public readonly violations: Violation[],
    message = "Assignment blocked by constraint violations",
  ) {
    super(message);
    this.name = "AssignmentBlockedError";
  }
}

/** Bounded number of retries for a Postgres serialization failure. */
const MAX_RETRIES = 2;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrowing an unknown caught value, not a genuine `any` usage
function isSerializationFailure(err: any): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code === "P2034") return true;
  const metaCode = (err.meta as { code?: unknown } | undefined)?.code;
  return metaCode === "40001";
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export type AssignStaffToShiftInput = {
  staffId: string;
  shiftId: string;
  assignedById: string;
  overrideReason?: string;
};

/**
 * Assigns a staff member to a shift, safely under concurrent access.
 *
 * The whole operation -- re-loading the constraint-engine context, running
 * `validateAssignment`, and writing the `ShiftAssignment` row -- happens
 * inside ONE `prisma.$transaction` at `Serializable` isolation. Validating
 * outside the transaction and writing inside it would defeat the purpose:
 * two concurrent callers could both read "no conflict" before either one
 * writes, and both would succeed. Under Serializable isolation, Postgres
 * instead aborts one of them with a serialization failure, which is caught
 * here and retried against a fresh read.
 */
export async function assignStaffToShift(
  input: AssignStaffToShiftInput,
): Promise<{ assignmentId: string }> {
  const { staffId, shiftId, assignedById, overrideReason } = input;

  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Loaded and re-validated INSIDE the transaction, against the
          // transaction's own client -- see the function doc comment for why.
          const ctx = await loadContext(staffId, shiftId, tx);
          const result = validateAssignment(ctx);

          if (!result.allowed) {
            throw new AssignmentBlockedError(result.violations);
          }
          if (result.requiresOverride && !overrideReason) {
            throw new AssignmentBlockedError(result.violations);
          }

          try {
            const created = await tx.shiftAssignment.create({
              data: {
                shiftId,
                staffId,
                assignedById,
                overrideReason: overrideReason ?? null,
              },
            });
            return { assignmentId: created.id };
          } catch (err) {
            if (isUniqueConstraintViolation(err)) {
              // Someone else won the race and already holds this exact
              // (shiftId, staffId) pair.
              throw new AssignmentConflictError(
                "Someone else already assigned this staff member to this shift.",
              );
            }
            throw err;
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      // Already-mapped errors propagate as-is, never retried.
      if (err instanceof AssignmentBlockedError || err instanceof AssignmentConflictError) {
        throw err;
      }

      if (isSerializationFailure(err)) {
        if (attempt < MAX_RETRIES) {
          continue;
        }
        throw new AssignmentConflictError(
          "This assignment could not be completed after retrying due to concurrent changes. Please refresh and try again.",
        );
      }

      throw err;
    }
  }
}
