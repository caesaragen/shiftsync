// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast } from "./ToastProvider";

function Trigger({ message, kind }: { message: string; kind?: "success" | "error" }) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast(message, kind)}>
      Fire
    </button>
  );
}

describe("ToastProvider / useToast", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a toast with the given message when triggered", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <Trigger message="Location created" />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Fire" }));
    expect(screen.getByRole("status")).toHaveTextContent("Location created");
  });

  it("styles error toasts distinctly from success toasts", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <Trigger message="Could not save" kind="error" />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Fire" }));
    expect(screen.getByRole("status")).toHaveClass("border-red-200");
  });

  it("auto-dismisses after its timeout", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <Trigger message="Skill added" />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Fire" }));
    expect(screen.getByRole("status")).toBeInTheDocument();

    vi.advanceTimersByTime(4100);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("dismisses a toast immediately when its close button is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <Trigger message="Staff certified" />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Fire" }));
    await user.click(screen.getByRole("button", { name: /dismiss notification/i }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
