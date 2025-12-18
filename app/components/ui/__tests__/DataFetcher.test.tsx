import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataFetcher } from '../DataFetcher';

// Mock the useApi hook
jest.mock('../../../lib/hooks/useApi', () => ({
  useApi: jest.fn(),
}));

import { useApi } from '../../../lib/hooks/useApi';
const mockUseApi = useApi as jest.MockedFunction<typeof useApi>;

describe('DataFetcher', () => {
const mockApiCall = jest.fn();
const TestChild = ({ data }: { data: unknown }) => <div data-testid="child">{JSON.stringify(data)}</div>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should render loading state initially', () => {
    mockUseApi.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refetch: jest.fn(),
    });

    render(
      <DataFetcher apiCall={mockApiCall}>
        {(data) => <TestChild data={data} />}
      </DataFetcher>
    );

    expect(screen.getByText('Loading data...')).toBeInTheDocument();
  });

  test('should render error state', () => {
    const mockRefetch = jest.fn();
    mockUseApi.mockReturnValue({
      data: null,
      loading: false,
      error: 'Network error',
      refetch: mockRefetch,
    });

    render(
      <DataFetcher apiCall={mockApiCall}>
        {(data) => <TestChild data={data} />}
      </DataFetcher>
    );

    expect(screen.getByText('Network error')).toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: /try again/i });
    userEvent.click(retryButton);
    expect(mockRefetch).toHaveBeenCalled();
  });

  test('should render data when available', () => {
    const testData = { message: 'Hello World' };
    mockUseApi.mockReturnValue({
      data: testData,
      loading: false,
      error: null,
      refetch: jest.fn(),
    });

    render(
      <DataFetcher apiCall={mockApiCall}>
        {(data) => <TestChild data={data} />}
      </DataFetcher>
    );

    expect(screen.getByTestId('child')).toHaveTextContent(JSON.stringify(testData));
  });

  test('should render empty state when no data', () => {
    mockUseApi.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: jest.fn(),
    });

    render(
      <DataFetcher apiCall={mockApiCall}>
        {(data) => <TestChild data={data} />}
      </DataFetcher>
    );

    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  test('should use custom loading component', () => {
    const CustomLoading = () => <div>Custom Loading...</div>;
    mockUseApi.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refetch: jest.fn(),
    });

    render(
      <DataFetcher apiCall={mockApiCall} loadingComponent={CustomLoading}>
        {(data) => <TestChild data={data} />}
      </DataFetcher>
    );

    expect(screen.getByText('Custom Loading...')).toBeInTheDocument();
  });

  test('should use custom error component', () => {
    const CustomError = ({ error, onRetry }: { error: string; onRetry: () => void }) => (
      <div>
        <span>Custom Error: {error}</span>
        <button onClick={onRetry}>Custom Retry</button>
      </div>
    );

    mockUseApi.mockReturnValue({
      data: null,
      loading: false,
      error: 'Custom error',
      refetch: jest.fn(),
    });

    render(
      <DataFetcher apiCall={mockApiCall} errorComponent={CustomError}>
        {(data) => <TestChild data={data} />}
      </DataFetcher>
    );

    expect(screen.getByText('Custom Error: Custom error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Custom Retry' })).toBeInTheDocument();
  });

  test('should pass cache options to useApi', () => {
    mockUseApi.mockReturnValue({
      data: { test: 'data' },
      loading: false,
      error: null,
      refetch: jest.fn(),
    });

    render(
      <DataFetcher
        apiCall={mockApiCall}
        cacheKey="test-cache"
        cacheTTL={300000}
        enableCache={false}
      >
        {(data) => <TestChild data={data} />}
      </DataFetcher>
    );

    expect(mockUseApi).toHaveBeenCalledWith(
      mockApiCall,
      {
        cacheKey: 'test-cache',
        cacheTTL: 300000,
        enableCache: false,
      }
    );
  });
});
