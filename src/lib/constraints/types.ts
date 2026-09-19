import type { Availability } from "@prisma/client";

/**
 * Shared types for the constraint engine. Every later constraint-engine
 * task and all of Phase 3's UI depend on these exact shapes -- do not
 * rename fields casually.
 */

export type Severity = "BLOCK" | "WARN" | "OVERRIDE_REQUIRED";

export type Violation = {
  /** Stable machine-readable id, e.g. "DOUBLE_BOOKING". */
  rule: string;
  severity: Severity;
  /** Human explanation naming the SPECIFIC conflict, not a generic phrase. */
  message: string;
};

export type EngineContext = {
  staff: { id: string; name: string; homeTimezone: string };
  shift: { id: string; locationId: string; startAt: Date; endAt: Date; requiredSkillId: string };
  /** The staff member's skills. */
  skillIds: string[];
  /** Active certifications only (endedAt IS NULL). */
  activeCertificationLocationIds: string[];
  availability: Availability[];
  /** Other shifts this staff member is already assigned to, excluding this one. */
  existingAssignments: { shiftId: string; startAt: Date; endAt: Date; locationId: string }[];
};
