import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataFetcher, PaginatedDataFetcher, RealtimeDataFetcher } from '../DataFetcher';
import { useApi, usePaginatedApi, usePollingApi } from '@/lib/hooks/useApi';

// Mock the useApi hooks so tests control loading/data/error deterministically
// (no network, no timers). DataFetcher builds its own apiCall from apiUrl.
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: jest.fn(),
  usePaginatedApi: jest.fn(),
  usePollingApi: jest.fn(),
}));

const mockUseApi = useApi as jest.Mock;
const mockUsePaginatedApi = usePaginatedApi as jest.Mock;
const mockUsePollingApi = usePollingApi as jest.Mock;

const TestChild = (data: unknown) => <div data-testid="child">{JSON.stringify(data)}</div>;

const mockState = (overrides: Record<string, unknown> = {}) => ({
  data: null,
  loading: false,
  error: null,
  refetch: jest.fn(),
  ...overrides,
});

describe('DataFetcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should render loading state initially', () => {
    mockUseApi.mockReturnValue(mockState({ loading: true }));

    render(
      <DataFetcher apiUrl="/api/test" render={TestChild} />
    );

    expect(screen.getByText('Loading data...')).toBeInTheDocument();
  });

  test('should render skeleton when loadingComponent is skeleton', () => {
    mockUseApi.mockReturnValue(mockState({ loading: true }));

    render(
      <DataFetcher apiUrl="/api/test" loadingComponent="skeleton" render={TestChild} />
    );

    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
  });

  test('should render error state and retry calls refetch', async () => {
    const mockRefetch = jest.fn();
    mockUseApi.mockReturnValue(mockState({ error: 'Network error', refetch: mockRefetch }));

    render(
      <DataFetcher apiUrl="/api/test" render={TestChild} />
    );

    expect(screen.getByText('Network error')).toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: /try again/i });
    await userEvent.click(retryButton);
    expect(mockRefetch).toHaveBeenCalled();
  });

  test('should render data when available', () => {
    const testData = { message: 'Hello World' };
    mockUseApi.mockReturnValue(mockState({ data: testData }));

    render(
      <DataFetcher apiUrl="/api/test" render={TestChild} />
    );

    expect(screen.getByTestId('child')).toHaveTextContent(JSON.stringify(testData));
  });

  test('should render empty state when no data', () => {
    mockUseApi.mockReturnValue(mockState({ data: null }));

    render(
      <DataFetcher apiUrl="/api/test" render={TestChild} />
    );

    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  test('should use custom error component', () => {
    const CustomError = ({ error, onRetry }: { error: string; onRetry: () => void }) => (
      <div>
        <span>Custom Error: {error}</span>
        <button onClick={onRetry}>Custom Retry</button>
      </div>
    );

    mockUseApi.mockReturnValue(mockState({ error: 'Custom error' }));

    render(
      <DataFetcher apiUrl="/api/test" errorComponent={CustomError} render={TestChild} />
    );

    expect(screen.getByText('Custom Error: Custom error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Custom Retry' })).toBeInTheDocument();
  });

  test('should pass cache options to useApi', () => {
    mockUseApi.mockReturnValue(mockState({ data: { test: 'data' } }));

    render(
      <DataFetcher apiUrl="/api/test" cacheKey="test-cache" cacheTTL={300000} enableCache={false} render={TestChild} />
    );

    expect(mockUseApi).toHaveBeenCalledWith(
      expect.any(Function),
      {
        cacheKey: 'test-cache',
        cacheTTL: 300000,
        enableCache: false,
      }
    );
  });
});

describe('PaginatedDataFetcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should render data from usePaginatedApi and expose loadMore', async () => {
    const loadMore = jest.fn();
    mockUsePaginatedApi.mockReturnValue(
      mockState({
        data: {
          items: [{ id: 1 }],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
        loadMore,
        hasMore: false,
      })
    );

    render(
      <PaginatedDataFetcher
        apiUrl="/api/items"
        render={({ items, loadMore }) => (
          <div>
            <span data-testid="count">{items.length}</span>
            <button onClick={loadMore}>More</button>
          </div>
        )}
      />
    );

    expect(screen.getByTestId('count')).toHaveTextContent('1');
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(loadMore).toHaveBeenCalled();
  });
});

describe('RealtimeDataFetcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should use polling hook and render data', () => {
    const testData = { price: 100 };
    mockUsePollingApi.mockReturnValue(mockState({ data: testData }));

    render(
      <RealtimeDataFetcher apiUrl="/api/live" pollInterval={5000} render={TestChild} />
    );

    expect(screen.getByTestId('child')).toHaveTextContent(JSON.stringify(testData));
  });
});
