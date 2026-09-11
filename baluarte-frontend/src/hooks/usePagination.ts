import { useEffect, useMemo, useState } from 'react';

export interface UsePaginationResult<T> {
  page: number;
  pageSize: number;
  total: number;
  pageItems: T[];
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
}

/** Paginação client-side; volta para a primeira página quando a lista muda de tamanho. */
export function usePagination<T>(items: T[], initialPageSize = 10): UsePaginationResult<T> {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    setPage((current) => Math.min(current, pages));
  }, [pages]);

  const pageItems = useMemo(() => {
    const start = (Math.min(page, pages) - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize, pages]);

  return {
    page: Math.min(page, pages),
    pageSize,
    total,
    pageItems,
    setPage: (next) => setPage(Math.max(1, Math.min(next, pages))),
    setPageSize: (size) => {
      setPageSizeState(size);
      setPage(1);
    },
  };
}
