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
  shift: {
    id: string;
    locationId: string;
    /** Display name of the shift's location, e.g. "Pier 39" -- for messages, not matching. */
    locationName: string;
    /** IANA zone of the shift's location, e.g. "America/Los_Angeles" -- may differ from the staff member's homeTimezone; that mismatch is exactly what UNAVAILABLE needs to explain. */
    locationTimezone: string;
    startAt: Date;
    endAt: Date;
    requiredSkillId: string;
    /** Display name of the required skill, e.g. "bartender" -- for messages, not matching. */
    requiredSkillName: string;
  };
  /**
   * The staff member's skills, id AND name together. Eligibility matching
   * is ALWAYS by id (`skills[i].id`), never by name -- names exist purely
   * so violation messages can say what the shift requires and what the
   * staff member actually has, instead of showing opaque ids.
   */
  skills: { id: string; name: string }[];
  /** Active certifications only (endedAt IS NULL). */
  activeCertificationLocationIds: string[];
  availability: Availability[];
  /** Other shifts this staff member is already assigned to, excluding this one. */
  existingAssignments: {
    shiftId: string;
    startAt: Date;
    endAt: Date;
    locationId: string;
    /** Display name of the existing shift's location, e.g. "Pier 39" -- for messages, not matching. */
    locationName: string;
    /** IANA zone of the existing shift's location. */
    locationTimezone: string;
  }[];
};
