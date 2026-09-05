import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AiActionButton from "../AiActionButton";

describe("AiActionButton", () => {
  test("renders the error status line when an error prop is passed", () => {
    render(
      <AiActionButton onClick={async () => {}} error="Credits exhausted">
        Analyze
      </AiActionButton>,
    );
    expect(screen.queryByText("Credits exhausted")).not.toBeNull();
    const btn = screen.getByRole("button", { name: "Analyze" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  test("does not render an error line when error is undefined or null", () => {
    const { rerender } = render(<AiActionButton onClick={async () => {}}>Analyze</AiActionButton>);
    expect(screen.queryByText("Credits exhausted")).toBeNull();

    rerender(
      <AiActionButton onClick={async () => {}} error={null}>
        Analyze
      </AiActionButton>,
    );
    expect(screen.queryByText("Credits exhausted")).toBeNull();
  });

  test("hides the error line while loading", () => {
    render(
      <AiActionButton onClick={async () => {}} loading error="Credits exhausted">
        Analyze
      </AiActionButton>,
    );
    expect(screen.queryByText("Credits exhausted")).toBeNull();
    const btn = screen.getByRole("button", { name: "Analyze" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  test("shows the rate-limit badge after a click — unchanged by the error prop", async () => {
    render(<AiActionButton onClick={async () => ({ remaining: 5, limit: 10 })}>Analyze</AiActionButton>);
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    await waitFor(() => expect(screen.queryByText("5/10 AI calls left")).not.toBeNull());
    expect(screen.queryByText("Credits exhausted")).toBeNull();
  });
});