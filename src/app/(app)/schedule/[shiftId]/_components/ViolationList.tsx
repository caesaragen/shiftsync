import type { Severity, Violation } from "@/lib/constraints/types";

/**
 * Fixed rendering order, most severe first. Not alphabetical and not the
 * order violations happen to arrive in from the engine -- a manager should
 * see what blocks the assignment before what merely warns about it.
 */
const SEVERITY_ORDER: Severity[] = ["BLOCK", "OVERRIDE_REQUIRED", "WARN"];

/**
 * Per-severity accessible + visible treatment. Severity is distinguished by
 * MORE than colour: BLOCK gets `role="alert"` (an assertive live region a
 * screen reader interrupts to announce), the others get `role="group"` with
 * a distinct `aria-label` PLUS a visible text prefix on every message --
 * so the distinction survives even with CSS disabled or for a
 * screen-reader user who never sees the colour at all.
 */
const SEVERITY_CONFIG: Record<
  Severity,
  {
    heading: string;
    prefix: string;
    ariaLabel: string;
    role: "alert" | "group";
    className: string;
  }
> = {
  BLOCK: {
    heading: "Blocked",
    prefix: "Blocked:",
    ariaLabel: "Blocking issues",
    role: "alert",
    className: "border-red-300 bg-red-50 text-red-900",
  },
  OVERRIDE_REQUIRED: {
    heading: "Override required",
    prefix: "Override required:",
    ariaLabel: "Override required",
    role: "group",
    className: "border-amber-300 bg-amber-50 text-amber-900",
  },
  WARN: {
    heading: "Warning",
    prefix: "Warning:",
    ariaLabel: "Warnings",
    role: "group",
    className: "border-yellow-300 bg-yellow-50 text-yellow-900",
  },
};

/**
 * Renders a `Violation[]` grouped by severity. Every message is rendered
 * VERBATIM -- this component never paraphrases, truncates, or recomputes
 * anything the constraint engine said; it only groups and labels.
 */
export function ViolationList({ violations }: { readonly violations: Violation[] }) {
  if (violations.length === 0) return null;

  const groups = SEVERITY_ORDER.map((severity) => ({
    severity,
    items: violations.filter((v) => v.severity === severity),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex flex-col gap-3">
      {groups.map(({ severity, items }) => {
        const config = SEVERITY_CONFIG[severity];
        return (
          <div
            key={severity}
            role={config.role}
            aria-label={config.ariaLabel}
            className={`rounded border p-3 text-sm ${config.className}`}
          >
            <p className="font-medium">{config.heading}</p>
            <ul className="mt-1 flex flex-col gap-1">
              {items.map((v) => (
                <li key={v.rule}>
                  <span className="font-medium">{config.prefix}</span> <span>{v.message}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
