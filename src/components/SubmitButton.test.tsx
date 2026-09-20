// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SubmitButton } from "./SubmitButton";

function pendingFormAction() {
  return new Promise<void>((resolve) => setTimeout(resolve, 20));
}

describe("SubmitButton", () => {
  it("renders its children and is enabled before submission", () => {
    render(
      <form action={pendingFormAction}>
        <SubmitButton pendingText="Saving…">Save</SubmitButton>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeEnabled();
  });

  it("shows pending text and disables itself while the form action is in flight", async () => {
    render(
      <form action={pendingFormAction}>
        <SubmitButton pendingText="Saving…">Save</SubmitButton>
      </form>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    const pendingButton = await screen.findByRole("button", { name: "Saving…" });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute("aria-busy", "true");

    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
  });

  it("falls back to a generic pending label when none is supplied", async () => {
    render(
      <form action={pendingFormAction}>
        <SubmitButton>Save</SubmitButton>
      </form>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Working…" })).toBeInTheDocument();
  });
});
