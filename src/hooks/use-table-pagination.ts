"use client";

import { useEffect, useMemo, useState } from "react";

export const DEFAULT_TABLE_PAGE_SIZE = 10;

export function useTablePagination<T>(items: T[], pageSize = DEFAULT_TABLE_PAGE_SIZE, resetKey = "") {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => {
    setPage(0);
  }, [resetKey]);

  useEffect(() => {
    setPage((current) => Math.min(current, Math.max(0, pageCount - 1)));
  }, [pageCount]);

  const safePage = Math.min(page, pageCount - 1);

  const pageItems = useMemo(
    () => items.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [items, pageSize, safePage]
  );

  return {
    page: safePage,
    pageCount,
    pageItems,
    pageSize,
    total: items.length,
    setPage,
    hasMultiplePages: items.length > pageSize
  };
}
