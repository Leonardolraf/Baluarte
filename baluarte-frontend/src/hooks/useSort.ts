import { useCallback, useMemo, useState } from 'react';
import type { SortDirection, SortState } from '@/types';

export type SortAccessor<T> = (item: T) => string | number | null | undefined;

export interface UseSortResult<T, K extends string> {
  sort: SortState<K> | null;
  sorted: T[];
  toggle: (key: K) => void;
  directionOf: (key: K) => SortDirection | null;
}

/**
 * Ordenação client-side por coluna. `accessors` mapeia chave -> valor comparável.
 * Clicar na mesma coluna alterna asc -> desc -> sem ordenação.
 */
export function useSort<T, K extends string>(
  items: T[],
  accessors: { [P in K]: SortAccessor<T> },
  initial: SortState<NoInfer<K>> | null = null,
): UseSortResult<T, K> {
  const [sort, setSort] = useState<SortState<K> | null>(initial);

  const toggle = useCallback((key: K) => {
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: 'asc' };
      if (current.direction === 'asc') return { key, direction: 'desc' };
      return null;
    });
  }, []);

  const sorted = useMemo(() => {
    if (!sort) return items;
    const accessor = accessors[sort.key];
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      const va = accessor(a);
      const vb = accessor(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
      return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true, sensitivity: 'base' }) * factor;
    });
  }, [items, sort, accessors]);

  const directionOf = useCallback((key: K) => (sort?.key === key ? sort.direction : null), [sort]);

  return { sort, sorted, toggle, directionOf };
}
