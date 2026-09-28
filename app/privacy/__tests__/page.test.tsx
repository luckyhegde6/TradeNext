import { render, screen, cleanup } from "@testing-library/react";
import PrivacyPage from "../page";

describe("PrivacyPage", () => {
  beforeEach(() => {
    cleanup();
  });

  test("renders the page title and hero", () => {
    render(<PrivacyPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Information We Collect" })).toBeTruthy();
  });

  test("lists what the app actually collects", () => {
    render(<PrivacyPage />);

    expect(screen.getByText(/Account information/)).toBeTruthy();
    expect(screen.getByText(/AI analysis inputs/)).toBeTruthy();
  });

  test("exposes the operator contact email", () => {
    render(<PrivacyPage />);

    const email = screen.getByText("luckyhegdedev+tradenext@gmail.com");
    expect(email.closest("a")?.getAttribute("href")).toBe("mailto:luckyhegdedev+tradenext@gmail.com");
  });
});