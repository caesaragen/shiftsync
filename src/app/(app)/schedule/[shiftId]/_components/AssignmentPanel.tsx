"use client";

import { useState, useTransition, type FormEvent } from "react";
import type { Violation } from "@/lib/constraints/types";
import type { Suggestion } from "@/lib/constraints/suggestions";
import { assignAction, unassignAction, suggestAlternativesAction } from "../actions";
import { ViolationList } from "./ViolationList";
import { useToast } from "@/components/toast/ToastProvider";

export type RosterEntry = {
  assignmentId: string;
  staffId: string;
  name: string;
};

export type CandidateVerdict = {
  staffId: string;
  name: string;
  allowed: boolean;
  requiresOverride: boolean;
  violations: Violation[];
};

function candidateStatusLabel(candidate: CandidateVerdict): string {
  if (!candidate.allowed) return "Blocked";
  if (candidate.requiresOverride) return "Requires override reason";
  if (candidate.violations.length > 0) return "Assignable with warnings";
  return "Assignable";
}

function candidateStatusClassName(candidate: CandidateVerdict): string {
  if (!candidate.allowed) return "text-red-700";
  if (candidate.requiresOverride || candidate.violations.length > 0) return "text-amber-700";
  return "text-green-700";
}

/** Stable sort: clean first, then warnings, then override-required, then blocked. */
function candidateSortRank(candidate: CandidateVerdict): number {
  if (!candidate.allowed) return 3;
  if (candidate.requiresOverride) return 2;
  if (candidate.violations.length > 0) return 1;
  return 0;
}

export function AssignmentPanel({
  shiftId,
  roster,
  candidates,
}: {
  readonly shiftId: string;
  readonly roster: RosterEntry[];
  readonly candidates: CandidateVerdict[];
}) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [submitResult, setSubmitResult] = useState<
    | null
    | { kind: "blocked"; violations: Violation[] }
    | { kind: "conflict"; message: string }
    | { kind: "error"; message: string }
  >(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [unassignError, setUnassignError] = useState<string | null>(null);

  const sortedCandidates = [...candidates].sort((a, b) => {
    const rankDiff = candidateSortRank(a) - candidateSortRank(b);
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name);
  });

  const selectedCandidate = candidates.find((c) => c.staffId === selectedStaffId) ?? null;

  function loadSuggestionsFor(staffId: string) {
    setSuggestionsLoading(true);
    setSuggestions(null);
    startTransition(async () => {
      const result = await suggestAlternativesAction(shiftId, staffId);
      setSuggestions(result);
      setSuggestionsLoading(false);
    });
  }

  function handleSelect(staffId: string) {
    setSelectedStaffId(staffId);
    setOverrideReason("");
    setSubmitResult(null);
    setSuggestions(null);
    const candidate = candidates.find((c) => c.staffId === staffId);
    if (candidate && !candidate.allowed) {
      loadSuggestionsFor(staffId);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCandidate) return;

    // No client-side check on the override reason here, deliberately: the
    // only enforcement is server-side, inside `assignStaffToShift` itself
    // (via assignAction below), which re-runs `validateAssignment` and
    // throws `AssignmentBlockedError` if `requiresOverride` is true and no
    // reason was supplied. A client-side gate here would duplicate that
    // decision instead of relying on it.
    startTransition(async () => {
      const result = await assignAction({
        staffId: selectedCandidate.staffId,
        shiftId,
        overrideReason: overrideReason || undefined,
      });

      if (result.ok) {
        toast(`${selectedCandidate.name} assigned to this shift.`);
        setSelectedStaffId(null);
        setOverrideReason("");
        setSubmitResult(null);
        setSuggestions(null);
        return;
      }

      if (result.kind === "blocked") {
        setSubmitResult({ kind: "blocked", violations: result.violations });
        loadSuggestionsFor(selectedCandidate.staffId);
        return;
      }

      if (result.kind === "conflict") {
        const message =
          "This shift changed while you were viewing it. Refresh to see the current state.";
        setSubmitResult({ kind: "conflict", message });
        toast(message, "error");
        return;
      }

      setSubmitResult({ kind: "error", message: result.message });
      toast(result.message, "error");
    });
  }

  function handleUnassign(assignmentId: string) {
    setUnassignError(null);
    const entry = roster.find((r) => r.assignmentId === assignmentId);
    startTransition(async () => {
      const result = await unassignAction({ assignmentId, shiftId });
      if (!result.ok) {
        setUnassignError(result.message);
        toast(result.message, "error");
        return;
      }
      toast(entry ? `${entry.name} unassigned from this shift.` : "Unassigned from this shift.");
    });
  }

  return (
    <div className="mt-10 flex flex-col gap-10">
      <section>
        <h2 className="text-base font-semibold tracking-tight">Roster</h2>
        {unassignError && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {unassignError}
          </p>
        )}
        {roster.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No one is assigned to this shift yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {roster.map((entry) => (
              <li
                key={entry.assignmentId}
                className="flex items-center justify-between rounded border px-3 py-2 text-sm"
              >
                <span>{entry.name}</span>
                <button
                  type="button"
                  onClick={() => handleUnassign(entry.assignmentId)}
                  disabled={isPending}
                  className="text-sm text-gray-600 underline underline-offset-4 hover:text-gray-900 disabled:opacity-50"
                >
                  Unassign
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-base font-semibold tracking-tight">Candidates</h2>
        {sortedCandidates.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            No staff are certified to work at this location.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Select a candidate to assign</legend>
              {sortedCandidates.map((candidate) => (
                <label
                  key={candidate.staffId}
                  className={`flex cursor-pointer items-center justify-between rounded border px-3 py-2 text-sm ${
                    selectedStaffId === candidate.staffId ? "border-accent" : "border-gray-300"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="candidate"
                      value={candidate.staffId}
                      checked={selectedStaffId === candidate.staffId}
                      onChange={() => handleSelect(candidate.staffId)}
                    />
                    {candidate.name}
                  </span>
                  <span className={`font-medium ${candidateStatusClassName(candidate)}`}>
                    {candidateStatusLabel(candidate)}
                  </span>
                </label>
              ))}
            </fieldset>

            {selectedCandidate && selectedCandidate.violations.length > 0 && !submitResult && (
              <div>
                <p className="text-sm text-gray-500">Before you assign:</p>
                <div className="mt-2">
                  <ViolationList violations={selectedCandidate.violations} />
                </div>
              </div>
            )}

            {selectedCandidate && !selectedCandidate.allowed && (
              <div className="rounded border border-gray-200 p-3 text-sm">
                <p className="font-medium text-gray-700">Suggested alternatives</p>
                {suggestionsLoading && (
                  <p className="mt-1 text-gray-500">Looking for alternatives…</p>
                )}
                {!suggestionsLoading && suggestions !== null && suggestions.length === 0 && (
                  <p className="mt-1 text-gray-500">
                    No other staff member is currently eligible for this shift.
                  </p>
                )}
                {!suggestionsLoading && suggestions !== null && suggestions.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-1">
                    {suggestions.map((s) => (
                      <li key={s.staffId}>
                        <span className="font-medium">{s.name}</span> — {s.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {selectedCandidate && selectedCandidate.requiresOverride && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Override reason (required)</span>
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  required
                  rows={2}
                  className="rounded border px-3 py-2 outline-none focus:ring-2 focus:ring-accent"
                />
              </label>
            )}

            {submitResult?.kind === "conflict" && (
              <p
                role="alert"
                className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
              >
                {submitResult.message}
              </p>
            )}

            {submitResult?.kind === "error" && (
              <p role="alert" className="text-sm text-red-600">
                {submitResult.message}
              </p>
            )}

            {submitResult?.kind === "blocked" && (
              <div>
                <p className="text-sm text-gray-500">The assignment could not be completed:</p>
                <div className="mt-2">
                  <ViolationList violations={submitResult.violations} />
                </div>
              </div>
            )}

            {/*
              Deliberately NOT disabled just because the precomputed verdict
              says "blocked" -- the verdict shown above is a preview, not the
              enforcement. Submitting always goes through the real
              `assignAction` call, which re-validates server-side and is the
              only source of truth for whether this assignment succeeds.
            */}
            <button
              type="submit"
              disabled={!selectedCandidate || isPending}
              className="w-fit rounded bg-accent px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {isPending ? "Assigning…" : "Assign"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
