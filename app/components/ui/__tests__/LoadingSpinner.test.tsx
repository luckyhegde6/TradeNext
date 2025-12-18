import { render, screen } from '@testing-library/react';
import { LoadingSpinner, Skeleton, CardSkeleton } from '../LoadingSpinner';

describe('Loading Components', () => {
  describe('LoadingSpinner', () => {
    test('should render with default props', () => {
      render(<LoadingSpinner />);

      const spinner = screen.getByRole('status');
      expect(spinner).toBeInTheDocument();
      expect(spinner).toHaveClass('w-8', 'h-8');
    });

    test('should render with custom size', () => {
      render(<LoadingSpinner size="lg" />);

      const spinner = screen.getByRole('status');
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
      expect(spinner).toHaveAttribute('aria-hidden', 'false');
    });
  });

  describe('Skeleton', () => {
    test('should render single line skeleton', () => {
      render(<Skeleton />);

      const skeletonLines = screen.getAllByRole('presentation');
      expect(skeletonLines).toHaveLength(1);
    });

    test('should render multiple skeleton lines', () => {
      render(<Skeleton lines={3} />);

      const skeletonLines = screen.getAllByRole('presentation');
      expect(skeletonLines).toHaveLength(3);
    });

    test('should apply custom className', () => {
      render(<Skeleton className="custom-skeleton" />);

      const container = screen.getByRole('presentation').parentElement;
      expect(container).toHaveClass('custom-skeleton');
    });

    test('should have different widths for multiple lines', () => {
      render(<Skeleton lines={3} />);

      const lines = screen.getAllByRole('presentation');
      expect(lines[0]).toHaveClass('w-full');
      expect(lines[1]).toHaveClass('w-full');
      expect(lines[2]).toHaveClass('w-3/4'); // Last line shorter
    });
  });

  describe('CardSkeleton', () => {
    test('should render card skeleton structure', () => {
      render(<CardSkeleton />);

      // Should have multiple skeleton elements
      const skeletonElements = screen.getAllByRole('presentation');
      expect(skeletonElements.length).toBeGreaterThan(1);
    });

    test('should apply custom className', () => {
      render(<CardSkeleton className="custom-card" />);

      const card = screen.getByRole('presentation').closest('.animate-pulse');
      expect(card).toHaveClass('custom-card');
    });
  });
});

