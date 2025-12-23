// hooks/useFilter.ts
import { useState, useMemo } from "react";

export function useFilter<T>(
  data: T[],
  predicate: (row: T, query: string) => boolean
) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () => data.filter(row => predicate(row, query)),
    [data, query]
  );

  return { query, setQuery, filtered };
}
