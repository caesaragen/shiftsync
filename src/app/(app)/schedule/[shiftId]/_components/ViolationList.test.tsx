// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Violation } from "@/lib/constraints/types";
import { ViolationList } from "./ViolationList";

const mixedViolations: Violation[] = [
  {
    rule: "SKILL_MISMATCH",
    severity: "BLOCK",
    message: "This shift requires bartender. Sarah Chen has server.",
  },
  {
    rule: "DAILY_HOURS_WARN",
    severity: "WARN",
    message:
      "Assigning this shift puts Sarah Chen at 9.5 hours on Fri Jun 19, exceeding the 8-hour threshold.",
  },
  {
    rule: "SEVENTH_CONSECUTIVE_DAY",
    severity: "OVERRIDE_REQUIRED",
    message:
      "Assigning this shift makes Sarah Chen's 7th consecutive worked day (Fri Jun 19). An override reason is required.",
  },
];

describe("ViolationList", () => {
  it("renders nothing when there are no violations", () => {
    const { container } = render(<ViolationList violations={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("groups a mixed violation list by severity, one group per severity present", () => {
    render(<ViolationList violations={mixedViolations} />);

    // Each severity present gets exactly one group.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    const groups = screen.getAllByRole("group");
    // One WARN group + one OVERRIDE_REQUIRED group (BLOCK uses role="alert").
    expect(groups).toHaveLength(2);
  });

  it("renders every violation's message text verbatim", () => {
    render(<ViolationList violations={mixedViolations} />);
    for (const v of mixedViolations) {
      expect(screen.getByText(v.message)).toBeInTheDocument();
    }
  });

  it("gives the BLOCK group role=alert, distinguishing it from WARN in the accessible tree", () => {
    render(<ViolationList violations={mixedViolations} />);

    const blockGroup = screen.getByRole("alert");
    expect(within(blockGroup).getByText(mixedViolations[0].message)).toBeInTheDocument();

    // The WARN group must NOT also be exposed as role=alert.
    const alertGroups = screen.getAllByRole("alert");
    expect(alertGroups).toHaveLength(1);
    expect(within(alertGroups[0]).queryByText(mixedViolations[1].message)).not.toBeInTheDocument();
  });

  it("gives WARN and OVERRIDE_REQUIRED groups distinct accessible names", () => {
    render(<ViolationList violations={mixedViolations} />);
    const groups = screen.getAllByRole("group");
    const names = groups.map((g) => g.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(names.length); // all distinct
    expect(names.some((n) => n?.toLowerCase().includes("warn"))).toBe(true);
    expect(names.some((n) => n?.toLowerCase().includes("override"))).toBe(true);
  });

  it("visibly marks the WARN group with a 'Warning' label, not colour alone", () => {
    render(<ViolationList violations={mixedViolations} />);
    // A visible textual marker must exist somewhere in the warn group's group container.
    const groups = screen.getAllByRole("group");
    const warnGroup = groups.find((g) =>
      g.getAttribute("aria-label")?.toLowerCase().includes("warn"),
    );
    expect(warnGroup).toBeDefined();
    expect(within(warnGroup!).getAllByText(/warning/i).length).toBeGreaterThan(0);
  });

  it("does not render a group for a severity that is not present", () => {
    render(
      <ViolationList
        violations={[
          {
            rule: "DAILY_HOURS_WARN",
            severity: "WARN",
            message: "Only a warning here.",
          },
        ]}
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByRole("group")).toHaveLength(1);
  });
});
