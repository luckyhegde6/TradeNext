// components/TableSkeleton.tsx
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
    return (
      <div className="space-y-3 animate-pulse">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="h-6 bg-gray-200 dark:bg-slate-800 rounded"
          />
        ))}
      </div>
    );
  }
  