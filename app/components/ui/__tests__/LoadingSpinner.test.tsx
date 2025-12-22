import { render, screen } from '@testing-library/react';
import { LoadingSpinner, Skeleton, CardSkeleton } from '../LoadingSpinner';

describe('Loading Components', () => {
  describe('LoadingSpinner', () => {
  test('should render with default props', () => {
    render(<LoadingSpinner />);

    const spinner = screen.getByTestId('loading-spinner');
    expect(spinner).toBeInTheDocument();
    expect(spinner).toHaveClass('w-8', 'h-8');
  });

  test('should render with custom size', () => {
    render(<LoadingSpinner size="lg" />);

    const spinner = screen.getByTestId('loading-spinner');
    expect(spinner).toHaveClass('w-12', 'h-12');
  });

    test('should render with custom message', () => {
      render(<LoadingSpinner message="Custom loading message" />);

      expect(screen.getByText('Custom loading message')).toBeInTheDocument();
    });

    test('should render with custom className', () => {
      render(<LoadingSpinner className="custom-class" />);

      const container = screen.getByText('Loading...').closest('div');
      expect(container).toHaveClass('custom-class');
    });

  test('should have proper accessibility attributes', () => {
    render(<LoadingSpinner />);

    const spinner = screen.getByRole('status');
    expect(spinner).toHaveAttribute('aria-label', 'Loading');
  });
  });

  describe('Skeleton', () => {
  test('should render single line skeleton', () => {
    render(<Skeleton />);

    const skeleton = screen.getByTestId('skeleton');
    expect(skeleton).toBeInTheDocument();
    const skeletonLines = skeleton.querySelectorAll('[role="presentation"]');
    expect(skeletonLines).toHaveLength(1);
  });

  test('should render multiple skeleton lines', () => {
    render(<Skeleton lines={3} />);

    const skeleton = screen.getByTestId('skeleton');
    expect(skeleton).toBeInTheDocument();
    const skeletonLines = skeleton.querySelectorAll('[role="presentation"]');
    expect(skeletonLines).toHaveLength(3);
  });

  test('should apply custom className', () => {
    render(<Skeleton className="custom-skeleton" />);

    const skeleton = screen.getByTestId('skeleton');
    expect(skeleton).toHaveClass('custom-skeleton');
  });

  test('should have different widths for multiple lines', () => {
    render(<Skeleton lines={3} />);

    const skeleton = screen.getByTestId('skeleton');
    expect(skeleton).toBeInTheDocument();
    const lines = skeleton.querySelectorAll('[role="presentation"]');
    expect(lines[0]).toHaveClass('w-full');
    expect(lines[1]).toHaveClass('w-full');
    expect(lines[2]).toHaveClass('w-3/4'); // Last line shorter
  });
  });

  describe('CardSkeleton', () => {
  test('should render card skeleton structure', () => {
    render(<CardSkeleton />);

    const cardSkeleton = screen.getByTestId('card-skeleton');
    expect(cardSkeleton).toBeInTheDocument();

    // Should have multiple skeleton elements
    const skeletonElements = cardSkeleton.querySelectorAll('[role="presentation"]');
    expect(skeletonElements.length).toBeGreaterThan(1);
  });

  test('should apply custom className', () => {
    render(<CardSkeleton className="custom-card" />);

    const card = screen.getByTestId('card-skeleton');
    expect(card).toHaveClass('custom-card');
  });
  });
});

