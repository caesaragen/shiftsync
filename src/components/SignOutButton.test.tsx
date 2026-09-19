// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignOutButton } from "./SignOutButton";

describe("SignOutButton", () => {
  it("renders an accessible sign-out control", () => {
    render(<SignOutButton onSignOut={vi.fn()} />);
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("invokes the sign-out action when clicked", async () => {
    const onSignOut = vi.fn();
    render(<SignOutButton onSignOut={onSignOut} />);
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
