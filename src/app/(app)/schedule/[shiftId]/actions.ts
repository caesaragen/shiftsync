"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole, assertCanManageLocation, ForbiddenError } from "@/lib/authz";
import { isWithinEditCutoff, EDIT_CUTOFF_HOURS } from "@/lib/shifts";
import { assignStaffToShift, AssignmentBlockedError, AssignmentConflictError } from "@/lib/assign";
import { suggestAlternatives, type Suggestion } from "@/lib/constraints/suggestions";
import type { Violation } from "@/lib/constraints/types";

export type AssignResult =
  | { ok: true; assignmentId: string }
  | { ok: false; kind: "blocked"; violations: Violation[] }
  | { ok: false; kind: "conflict"; message: string }
  | { ok: false; kind: "error"; message: string };

/**
 * Assigns `staffId` to `shiftId`. Never re-implements any constraint check
 * itself -- the ONLY source of truth for whether this assignment is allowed
 * is `assignStaffToShift`, which re-runs `loadContext` + `validateAssignment`
 * inside its own transaction. This action's only job is authorization,
 * translating its thrown errors into a shape the client component can
 * render, and revalidating the page on success.
 */
export async function assignAction(input: {
  staffId: string;
  shiftId: string;
  overrideReason?: string;
}): Promise<AssignResult> {
  // Authorization first, before any validation or database work. Server
  // Actions are publicly callable HTTP endpoints regardless of what the UI
  // renders, so this must not be skippable by calling the action directly.
  const user = await requireRole("MANAGER", "ADMIN");

  const shift = await prisma.shift.findUnique({ where: { id: input.shiftId } });
  if (!shift) {
    return { ok: false, kind: "error", message: "This shift no longer exists." };
  }

  try {
    await assertCanManageLocation(user, shift.locationId);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, kind: "error", message: error.message };
    }
    throw error;
  }

  // Blank/whitespace-only reason is treated as "no reason supplied" so a
  // manager can't satisfy the OVERRIDE_REQUIRED check by submitting an
  // empty string.
  const overrideReason = input.overrideReason?.trim() || undefined;

  try {
    const { assignmentId } = await assignStaffToShift({
      staffId: input.staffId,
      shiftId: input.shiftId,
      assignedById: user.id,
      overrideReason,
    });
    revalidatePath(`/schedule/${input.shiftId}`);
    return { ok: true, assignmentId };
  } catch (error) {
    if (error instanceof AssignmentBlockedError) {
      return { ok: false, kind: "blocked", violations: error.violations };
    }
    if (error instanceof AssignmentConflictError) {
      return { ok: false, kind: "conflict", message: error.message };
    }
    throw error;
  }
}

export type UnassignResult = { ok: true } | { ok: false; message: string };

/**
 * Unassigns a staff member from a shift, subject to the same 48-hour edit
 * cutoff `isWithinEditCutoff` already enforces elsewhere (imported from
 * `shifts.ts`, not re-implemented here).
 */
export async function unassignAction(input: {
  assignmentId: string;
  shiftId: string;
}): Promise<UnassignResult> {
  const user = await requireRole("MANAGER", "ADMIN");

  const assignment = await prisma.shiftAssignment.findUnique({
    where: { id: input.assignmentId },
    include: { shift: true },
  });

  if (!assignment || assignment.shiftId !== input.shiftId) {
    return { ok: false, message: "This assignment no longer exists." };
  }

  try {
    await assertCanManageLocation(user, assignment.shift.locationId);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }

  if (isWithinEditCutoff(assignment.shift, new Date())) {
    return {
      ok: false,
      message: `This shift starts within the ${EDIT_CUTOFF_HOURS}-hour edit cutoff and can no longer be changed.`,
    };
  }

  await prisma.shiftAssignment.delete({ where: { id: input.assignmentId } });
  revalidatePath(`/schedule/${input.shiftId}`);
  return { ok: true };
}

/**
 * Thin wrapper around `suggestAlternatives` exposed as a Server Action so
 * the client `AssignmentPanel` can fetch real alternatives for a blocked
 * candidate. Read-only, but still gated to managers/admins -- it returns
 * other staff members' names and schedules, which is only meant for the
 * people running this assignment workflow.
 */
export async function suggestAlternativesAction(
  shiftId: string,
  excludeStaffId?: string,
): Promise<Suggestion[]> {
  await requireRole("MANAGER", "ADMIN");
  return suggestAlternatives(shiftId, excludeStaffId);
}
