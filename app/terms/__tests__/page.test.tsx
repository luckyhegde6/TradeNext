import { render, screen, cleanup } from "@testing-library/react";
import TermsPage from "../page";

describe("TermsPage", () => {
  beforeEach(() => {
    cleanup();
  });

  test("renders the page title and hero", () => {
    render(<TermsPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Not Financial Advice" })).toBeTruthy();
  });

  test("states the tool-not-adviser promise", () => {
    render(<TermsPage />);

    expect(screen.getByText(/TradeNext is a tool, not an adviser/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Governing Law" })).toBeTruthy();
    expect(screen.getByText(/laws of India/)).toBeTruthy();
  });

  test("exposes the operator contact email", () => {
    render(<TermsPage />);

    const email = screen.getByText("luckyhegdedev+tradenext@gmail.com");
    expect(email.closest("a")?.getAttribute("href")).toBe("mailto:luckyhegdedev+tradenext@gmail.com");
  });
});