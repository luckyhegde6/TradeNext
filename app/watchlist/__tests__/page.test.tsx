import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { useSession } from "next-auth/react";
import WatchlistPage from "../page";

jest.mock("next-auth/react", () => ({
  useSession: jest.fn(),
}));

jest.mock("@/app/components/AiActionButton", () => {
  const MockAiActionButton = ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    [key: string]: unknown;
  }) => <button {...props}>{children}</button>;
  return { __esModule: true, default: MockAiActionButton };
});

jest.mock("@/app/components/ui/Autocomplete", () => {
  const MockAutocomplete = ({ placeholder }: { placeholder: string }) => (
    <input placeholder={placeholder} />
  );
  return { __esModule: true, default: MockAutocomplete };
});

jest.mock("@/lib/hooks/useLivePrices", () => ({
  useLivePrices: () => ({ prices: new Map(), isLive: false }),
}));

const mockUseSession = useSession as jest.Mock;

beforeEach(() => {
  cleanup();
  mockUseSession.mockReset();
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ watchlists: [] }),
  })) as unknown as typeof fetch;
});

describe("WatchlistPage", () => {
  test("shows the sign-in prompt for unauthenticated users (no eternal skeleton)", () => {
    mockUseSession.mockReturnValue({ data: null, status: "unauthenticated" });
    const { container } = render(<WatchlistPage />);

    expect(screen.queryByText("Please sign in to view your watchlist.")).not.toBeNull();
    expect(container.querySelector(".animate-pulse")).toBeNull();
    expect(screen.queryByText("Create Watchlist")).toBeNull();
  });

  test("renders the skeleton while the session is loading", () => {
    mockUseSession.mockReturnValue({ data: null, status: "loading" });
    const { container } = render(<WatchlistPage />);

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByText("Please sign in to view your watchlist.")).toBeNull();
  });

  test("shows the empty-state CTA for an authenticated user with no watchlists", async () => {
    mockUseSession.mockReturnValue({
      data: { user: { name: "Demo User", email: "demo@tradenext6.app" } },
      status: "authenticated",
    });
    render(<WatchlistPage />);

    await waitFor(() =>
      expect(screen.queryByText("You haven't created any watchlists yet.")).not.toBeNull(),
    );
    expect(screen.queryByText("Create Your First Watchlist")).not.toBeNull();
    expect(screen.queryByText("Please sign in to view your watchlist.")).toBeNull();
  });
});